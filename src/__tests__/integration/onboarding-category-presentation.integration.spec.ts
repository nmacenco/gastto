import { CancelConversationFlow } from '../../application/use-cases/conversation/CancelConversationFlow';
import { createLogger } from '../../infrastructure/logger';
// Real PostgreSQL/Redis lifecycle; OAuth, Sheets and messaging are the only simulated providers.
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import * as schema from '../../infrastructure/db/schema';
import { DrizzleUserRepository } from '../../infrastructure/db/repositories/DrizzleUserRepository';
import { DrizzleConversationStateRepository } from '../../infrastructure/db/repositories/DrizzleConversationStateRepository';
import { DrizzleSpreadsheetConfigRepository } from '../../infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository';
import { DrizzleColumnMappingRepository } from '../../infrastructure/db/repositories/DrizzleColumnMappingRepository';
import { DrizzleCategoryVocabularyRepository } from '../../infrastructure/db/repositories/DrizzleCategoryVocabularyRepository';
import { DrizzleOAuthTokenRepository } from '../../infrastructure/db/repositories/DrizzleOAuthTokenRepository';
import { DrizzleOnboardingVocabularyCommit } from '../../infrastructure/db/repositories/DrizzleOnboardingVocabularyCommit';
import { DrizzleAccountDeletionRepository } from '../../infrastructure/db/repositories/DrizzleAccountDeletionRepository';
import { RedisMappingCorrectionStateRepository } from '../../infrastructure/redis/RedisMappingCorrectionStateRepository';
import { RedisUserProcessingLock } from '../../infrastructure/redis/RedisUserProcessingLock';
import { RedisRestoreGuard } from '../../infrastructure/redis/RedisRestoreGuard';
import { AccountOperationalCleanup } from '../../infrastructure/redis/AccountOperationalCleanup';
import { TokenEncryptionAdapter } from '../../infrastructure/security/TokenEncryptionAdapter';
import { SpreadsheetCategoryHierarchyReaderFactory } from '../../infrastructure/adapters/sheets/SpreadsheetCategoryHierarchyReaderFactory';
import { SpreadsheetCategoryReaderFactory } from '../../infrastructure/adapters/sheets/SpreadsheetCategoryReaderFactory';
import { ResolveUserIdentityUseCase } from '../../application/use-cases/user/ResolveUserIdentity';
import { RevokeAccountCredentials } from '../../application/use-cases/user/RevokeAccountCredentials';
import { AccountDeletionService } from '../../application/services/AccountDeletionService';
import { OAuthAccessTokenService } from '../../application/services/OAuthAccessTokenService';
import { TransitionConversationState } from '../../application/use-cases/conversation/TransitionConversationState';
import { ConfirmColumnMapping } from '../../application/use-cases/spreadsheet/ConfirmColumnMapping';
import { DetectCategories } from '../../application/use-cases/spreadsheet/DetectCategories';
import { ConfirmCategories } from '../../application/use-cases/spreadsheet/ConfirmCategories';
import { DetectPaymentMethods } from '../../application/use-cases/spreadsheet/DetectPaymentMethods';
import {
  isCategoryProposalPresented,
  isCategoryProposalAccepted,
} from '../../application/dtos/CategoryOnboardingState';
import type { Row, SpreadsheetPort } from '../../domain/ports/services';
import type { OAuthServicePort } from '../../domain/ports/oauth';
import type { MessagingOutputPort } from '../../application/ports/output/messaging.port';

const describeIntegration =
  process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;

describeIntegration('category presentation after account deletion (PostgreSQL + Redis)', () => {
  let pg: StartedPostgreSqlContainer;
  let rc: StartedTestContainer;
  let sql: postgres.Sql;
  let redis: Redis;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let incoming: Queue;
  let processing: Queue;
  let reminders: Queue;
  beforeAll(async () => {
    [pg, rc] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);
    sql = postgres(pg.getConnectionUri(), { max: 3 });
    db = drizzle(sql, { schema });
    await migrate(db, {
      migrationsFolder: path.resolve(__dirname, '../../infrastructure/db/migrations'),
    });
    redis = new Redis(rc.getMappedPort(6379), rc.getHost());
    await redis.ping();
    incoming = new Queue('presentation-incoming', { connection: redis });
    processing = new Queue('presentation-processing', { connection: redis });
    reminders = new Queue('presentation-reminders', { connection: redis });
  });
  afterAll(async () => {
    await Promise.all([incoming?.close(), processing?.close(), reminders?.close()]);
    redis?.disconnect();
    if (sql) await sql.end();
    await Promise.all([pg?.stop(), rc?.stop()]);
  });

  async function setup(externalId = randomUUID()) {
    const users = new DrizzleUserRepository(db, redis);
    const states = new DrizzleConversationStateRepository(db);
    const identity = await new ResolveUserIdentityUseCase(users, states).execute({
      channel: 'telegram',
      externalId,
    });
    expect(identity.isNewUser).toBe(true);
    const userId = identity.userId;
    const transition = new TransitionConversationState(states);
    const configs = new DrizzleSpreadsheetConfigRepository(db);
    const mappings = new DrizzleColumnMappingRepository(db);
    const vocabulary = new DrizzleCategoryVocabularyRepository(db);
    const tokenRepo = new DrizzleOAuthTokenRepository(db);
    const encryption = new TokenEncryptionAdapter(randomBytes(32).toString('hex'));
    const access = encryption.encrypt('mock-access');
    const refresh = encryption.encrypt('mock-refresh');
    await tokenRepo.upsert({
      userId,
      provider: 'google',
      accessTokenEnc: access.ciphertext,
      refreshTokenEnc: refresh.ciphertext,
      iv: access.iv,
      refreshIv: refresh.iv,
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      scope: ['https://www.googleapis.com/auth/spreadsheets'],
      grantedAt: new Date(),
      lastRefreshedAt: null,
      revokedAt: null,
    });
    const revokeToken = vi.fn<OAuthServicePort['revokeToken']>().mockResolvedValue('revoked');
    const oauth = { revokeToken, refreshAccessToken: vi.fn() } as unknown as OAuthServicePort;
    const tokenService = new OAuthAccessTokenService({
      tokenRepository: tokenRepo,
      tokenEncryption: encryption,
      oauthService: oauth,
    });
    const rows: Row[] = [
      { index: 3, values: ['Visa', '12', 'Comida', 'Restaurante'] },
      { index: 4, values: ['Efectivo', '8', 'Transporte', 'Peajes'] },
      { index: 5, values: ['Visa', '2', 'Salud', ''] },
    ];
    const sheet: SpreadsheetPort = {
      readRows: vi.fn().mockImplementation(() => Promise.resolve(structuredClone(rows))),
      getUniqueValues: vi
        .fn()
        .mockImplementation((_file: string, column: number) =>
          Promise.resolve(rows.map((row) => String(row.values[column]))),
        ),
      appendRow: vi.fn(),
      deleteRow: vi.fn(),
      getHeaders: vi.fn(),
      listSheets: vi.fn(),
      validateAccess: vi.fn(),
    };
    const factory = { create: (_token: string) => sheet };
    const send = vi
      .fn<MessagingOutputPort['sendMessage']>()
      .mockResolvedValue({ status: 'success' });
    const common = {
      spreadsheetConfigRepository: configs,
      columnMappingRepository: mappings,
      categoryVocabularyRepository: vocabulary,
      messagingPort: { sendMessage: send },
      transitionState: transition,
    };
    const detect = new DetectCategories({
      ...common,
      oauthAccessTokenService: tokenService,
      categoryReaderPortFactory: new SpreadsheetCategoryReaderFactory(factory),
      categoryHierarchyReaderPortFactory: new SpreadsheetCategoryHierarchyReaderFactory(factory),
    });
    const confirm = new ConfirmCategories({
      ...common,
      userRepository: users,
      detectCategories: detect,
      detectPaymentMethods: new DetectPaymentMethods({
        tokenService,
        spreadsheetPortFactory: factory,
      }),
      onboardingCommit: new DrizzleOnboardingVocabularyCommit(db),
    });
    const corrections = new RedisMappingCorrectionStateRepository(redis);
    const mappingConfirmation = new ConfirmColumnMapping({
      ...common,
      correctionStateRepository: corrections,
    });
    const config = await configs.createOrResumeInitial({
      userId,
      provider: 'google',
      fileId: 'file-123',
      fileName: 'Expenses',
      sheetName: 'Gastos',
      accessVerifiedAt: new Date(),
      categoriesConfirmedAt: null,
    });
    await transition.runForUser(userId, async () => {
      for (const targetState of [
        'ONBOARDING_DRIVE',
        'ONBOARDING_FILE',
        'ONBOARDING_SHEET',
        'ONBOARDING_VALIDATING_ACCESS',
        'ONBOARDING_MAPPING',
      ] as const) {
        await transition.execute({ userId, targetState });
      }
      await transition.execute({
        userId,
        targetState: 'ONBOARDING_MAPPING',
        payload: {
          spreadsheetId: config.id,
          proposalId: randomUUID(),
          provider: config.provider,
          fileId: config.fileId,
          sheetName: config.sheetName,
          headerRowIndex: 2,
          mappings: [
            { gasttoField: 'medio_pago', columnIndex: 0, columnHeader: 'Pago' },
            { gasttoField: 'categoria', columnIndex: 2, columnHeader: 'Categoría' },
            { gasttoField: 'subcategoria', columnIndex: 3, columnHeader: 'Subcategoría' },
          ],
        },
      });
      await mappingConfirmation.execute({
        userId,
        externalId,
        channel: 'telegram',
        statePayload: transition.currentState(userId)!.statePayload,
      });
    });
    const input = async () => ({
      userId,
      externalId,
      channel: 'telegram' as const,
      statePayload: (await states.findByUserId(userId))!.statePayload,
    });
    const propose = () => transition.runForUser(userId, async () => detect.execute(await input()));
    const reply = () => transition.runForUser(userId, async () => confirm.execute(await input()));
    return {
      userId,
      externalId,
      users,
      states,
      configs,
      config,
      mappings,
      transition,
      tokenRepo,
      encryption,
      revokeToken,
      send,
      sheet,
      rows,
      propose,
      reply,
      input,
      confirm,
      detect,
    };
  }

  async function finish(h: Awaited<ReturnType<typeof setup>>) {
    await h.propose();
    expect(isCategoryProposalPresented((await h.input()).statePayload)).toBe(true);
    await h.reply();
    const payment = (await h.input()).statePayload!;
    expect(isCategoryProposalAccepted(payment)).toBe(true);
    expect(payment.paymentMethods).toEqual(['Visa', 'Efectivo']);
    expect(payment.paymentColumnMapped).toBe(true);
    expect((await h.users.findById(h.userId))!.status).toBe('onboarding');
    await h.reply();
    expect(await h.states.findByUserId(h.userId)).toMatchObject({
      currentState: 'IDLE',
      statePayload: null,
    });
    expect((await h.users.findById(h.userId))!.status).toBe('active');
  }

  it('deletes an account, registers the same chat as a new owner, presents C/D then A, and atomically activates', async () => {
    const old = await setup();
    await finish(old);
    const oldVocabulary = await new DrizzleCategoryVocabularyRepository(db).findBySpreadsheetId(
      old.config.id,
    );
    const oldChildren = oldVocabulary!.getSubcategories().map((child) => child.id);
    await redis.set(`conversation:${old.userId}:mapping-correction`, 'old proposal');
    await redis.set(`oauth:state:${old.userId}`, JSON.stringify({ userId: old.userId }));
    const oldJob = await processing.add('message', { userId: old.userId, rawMessage: 'old draft' });
    const deletion = new DrizzleAccountDeletionRepository(db);
    expect(await deletion.begin(old.userId)).toBe(true);
    const cleanup = new AccountOperationalCleanup(redis, incoming, processing, reminders);
    const service = new AccountDeletionService(
      deletion,
      new RevokeAccountCredentials(deletion, old.encryption, { revokeToken: old.revokeToken }),
      cleanup,
      new RedisUserProcessingLock(redis),
      { sendMessage: old.send },
      new RedisRestoreGuard(db, redis),
    );
    const originalSheet = structuredClone(old.rows);
    await service.resume(old.userId);
    expect(old.revokeToken).toHaveBeenCalledWith('google', 'mock-refresh');
    expect(old.rows).toEqual(originalSheet);
    expect(vi.spyOn(old.sheet, 'appendRow').mock.calls).toHaveLength(0);
    expect(vi.spyOn(old.sheet, 'deleteRow').mock.calls).toHaveLength(0);
    expect(await old.users.findById(old.userId)).toBeNull();
    expect(await old.states.findByUserId(old.userId)).toBeNull();
    expect(await old.configs.findById(old.config.id)).toBeNull();
    expect(await old.mappings.findBySpreadsheetId(old.config.id)).toEqual([]);
    expect(await old.tokenRepo.findByUserAndProvider(old.userId, 'google')).toBeNull();
    expect(
      await new DrizzleCategoryVocabularyRepository(db).findBySpreadsheetId(old.config.id),
    ).toBeNull();
    expect(
      await db
        .select()
        .from(schema.userPaymentMethods)
        .where(eq(schema.userPaymentMethods.spreadsheetId, old.config.id)),
    ).toEqual([]);
    for (const id of oldChildren)
      expect(
        await db.select().from(schema.userSubcategories).where(eq(schema.userSubcategories.id, id)),
      ).toEqual([]);
    expect(await redis.get(`identity:telegram:${old.externalId}`)).toBeNull();
    expect(await redis.get(`conversation:${old.userId}:mapping-correction`)).toBeNull();
    expect(await redis.get(`oauth:state:${old.userId}`)).toBeNull();
    expect(await processing.getJob(oldJob.id!)).toBeUndefined();

    const fresh = await setup(old.externalId);
    expect(fresh.userId).not.toBe(old.userId);
    expect(fresh.config.id).not.toBe(old.config.id);
    expect((await fresh.input()).statePayload).not.toHaveProperty('categoryDraft');
    await finish(fresh);
    const categories = await new DrizzleCategoryVocabularyRepository(db).findBySpreadsheetId(
      fresh.config.id,
    );
    expect(categories!.getCategories().map((row) => row.name)).toEqual([
      'comida',
      'transporte',
      'salud',
    ]);
    expect(categories!.getSubcategories().map((row) => row.name)).toEqual([
      'restaurante',
      'peajes',
    ]);
    const paymentRows = await db
      .select()
      .from(schema.userPaymentMethods)
      .where(eq(schema.userPaymentMethods.spreadsheetId, fresh.config.id));
    expect(paymentRows.map((row) => row.displayName)).toEqual(['Visa', 'Efectivo']);
    const messages = fresh.send.mock.calls.map((call) => call[1]);
    const hierarchyIndex = messages.findIndex((message) => message.includes('restaurante'));
    const paymentIndex = messages.findIndex((message) => message.includes('Visa'));
    expect(hierarchyIndex).toBeGreaterThanOrEqual(0);
    expect(paymentIndex).toBeGreaterThan(hierarchyIndex);
    expect(messages.at(-1)).toContain('¡Todo listo!');
    expect(vi.spyOn(fresh.sheet, 'readRows').mock.calls[0]).toEqual(['file-123', "'Gastos'!A3:D"]);
    expect(vi.spyOn(fresh.sheet, 'getUniqueValues').mock.calls[0]).toEqual([
      'file-123',
      0,
      'Gastos',
      3,
    ]);
    expect(await fresh.users.findByMessagingIdentity('telegram', old.externalId)).toMatchObject({
      userId: fresh.userId,
    });
  });

  it('resumes a failed delivery by presenting the same identified hierarchy, then waits for another confirmation', async () => {
    const h = await setup();
    h.send.mockResolvedValueOnce({ status: 'failure', errorCode: 'NETWORK_ERROR' });
    await h.propose();
    const before = (await h.input()).statePayload!;
    expect(before.categoryPresentation).toBeNull();
    await h.reply();
    const after = (await h.input()).statePayload!;
    expect(after.categoryDraft).toEqual(before.categoryDraft);
    expect(after.categoryProposalId).not.toBe(before.categoryProposalId);
    expect(isCategoryProposalPresented(after)).toBe(true);
    expect(after.paymentReview).toBeUndefined();
    expect(vi.spyOn(h.sheet, 'getUniqueValues').mock.calls).toHaveLength(0);
    expect(
      await new DrizzleCategoryVocabularyRepository(db).findBySpreadsheetId(h.config.id),
    ).toBeNull();
    await h.reply();
    expect((await h.input()).statePayload!.paymentMethods).toEqual(['Visa', 'Efectivo']);
  });

  it('cannot record presentation against a newer draft revision', async () => {
    const h = await setup();
    h.send.mockImplementationOnce(async () => {
      const other = new TransitionConversationState(h.states);
      await other.runForUser(h.userId, async () => {
        const current = other.currentState(h.userId)!;
        await other.execute({
          userId: h.userId,
          targetState: 'ONBOARDING_CATEGORIES',
          payload: {
            ...current.statePayload,
            categoryProposalId: 'newer-proposal',
            categoryPresentation: null,
          },
        });
      });
      return { status: 'success' };
    });
    await expect(h.propose()).rejects.toHaveProperty('name', 'StaleConversationStateError');
    const current = (await h.input()).statePayload!;
    expect(current.categoryProposalId).toBe('newer-proposal');
    expect(isCategoryProposalPresented(current)).toBe(false);
    expect((await h.users.findById(h.userId))!.status).toBe('onboarding');
  });
  it.each([
    { categories: ['Cocina', 'Viajes'] },
    {
      categories: [{ name: 'Cocina', subcategories: ['Mercado'] }],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    },
  ])(
    're-presents an equivalent legacy draft with verified destination before accepting it: %#',
    async (legacy) => {
      const h = await setup();
      const mapping = (await h.input()).statePayload!;
      const legacyPayload = {
        provider: mapping.provider,
        fileId: mapping.fileId,
        sheetName: mapping.sheetName,
        ...legacy,
      };
      await h.transition.runForUser(h.userId, () =>
        h.transition.execute({
          userId: h.userId,
          targetState: 'ONBOARDING_CATEGORIES',
          payload: legacyPayload,
        }),
      );
      await h.reply();
      const current = (await h.input()).statePayload!;
      expect(isCategoryProposalPresented(current)).toBe(true);
      expect(current.paymentReview).toBeUndefined();
      expect(current.categories).toEqual(
        typeof legacy.categories[0] === 'string'
          ? legacy.categories.map((name) => ({ name, subcategories: [] }))
          : legacy.categories,
      );
      expect(vi.spyOn(h.sheet, 'readRows').mock.calls).toHaveLength(0);
      expect((await h.users.findById(h.userId))!.status).toBe('onboarding');
      await h.reply();
      expect((await h.input()).statePayload!.paymentReview).toBe(true);
    },
  );

  it('re-detects hidden legacy defaults even if an old payment-review flag is present', async () => {
    const h = await setup();
    const mapping = (await h.input()).statePayload!;
    await h.transition.runForUser(h.userId, () =>
      h.transition.execute({
        userId: h.userId,
        targetState: 'ONBOARDING_CATEGORIES',
        payload: {
          provider: mapping.provider,
          fileId: mapping.fileId,
          sheetName: mapping.sheetName,
          headerRowIndex: 2,
          categories: ['alimentacion', 'transporte', 'servicios', 'ocio', 'salud', 'otros'].map(
            (name) => ({ name, subcategories: [] }),
          ),
          orphanSubcategories: [],
          subcategoryColumnMapped: false,
          paymentReview: true,
          paymentMethods: [],
          paymentColumnMapped: false,
        },
      }),
    );
    await h.reply();
    const current = (await h.input()).statePayload!;
    expect(current.categories).toEqual([
      { name: 'comida', subcategories: ['restaurante'] },
      { name: 'transporte', subcategories: ['peajes'] },
      { name: 'salud', subcategories: [] },
    ]);
    expect(current.paymentReview).toBeUndefined();
    expect(vi.spyOn(h.sheet, 'getUniqueValues').mock.calls).toHaveLength(0);
    await h.reply();
    await h.reply();
    const saved = await new DrizzleCategoryVocabularyRepository(db).findBySpreadsheetId(
      h.config.id,
    );
    expect(saved!.getCategories().map((row) => row.name)).not.toContain('alimentacion');
    expect((await h.users.findById(h.userId))!.status).toBe('active');
  });

  it('cancels an unpresented draft without catalog writes or activation', async () => {
    const h = await setup();
    h.send.mockResolvedValueOnce({ status: 'failure', errorCode: 'NETWORK_ERROR' });
    await h.propose();
    const cancel = new CancelConversationFlow({
      transitionState: h.transition,
      spreadsheetConfigRepository: h.configs,
      mappingCorrectionStateRepository: new RedisMappingCorrectionStateRepository(redis),
      logger: createLogger({ level: 'silent' }),
    });
    await h.transition.runForUser(h.userId, () =>
      cancel.execute({
        userId: h.userId,
        externalId: h.externalId,
        channel: 'telegram',
        state: h.transition.currentState(h.userId)!,
        source: 'text',
        messagingPort: { sendMessage: h.send },
      }),
    );
    expect(await h.states.findByUserId(h.userId)).toMatchObject({
      currentState: 'IDLE',
      statePayload: null,
      expiresAt: null,
    });
    expect(
      await new DrizzleCategoryVocabularyRepository(db).findBySpreadsheetId(h.config.id),
    ).toBeNull();
    expect((await h.users.findById(h.userId))!.status).toBe('onboarding');
  });
  it('preserves identified legacy vocabulary while recapturing verified mapping context', async () => {
    const h = await setup();
    await h.propose();
    const original = (await h.input()).statePayload!;
    const legacy = { ...original };
    for (const key of [
      'confirmedMappings',
      'categoryProposalId',
      'categoryPresentation',
      'categoryAcceptance',
    ])
      delete legacy[key];
    await h.transition.runForUser(h.userId, () =>
      h.transition.execute({
        userId: h.userId,
        targetState: 'ONBOARDING_CATEGORIES',
        payload: legacy,
      }),
    );
    await h.reply();
    const current = (await h.input()).statePayload!;
    expect(current.categoryDraft).toEqual(original.categoryDraft);
    expect(current.categories).toEqual(original.categories);
    expect(isCategoryProposalPresented(current)).toBe(true);
    expect(current.paymentReview).toBeUndefined();
    expect(vi.spyOn(h.sheet, 'readRows').mock.calls).toHaveLength(1);
  });
});
