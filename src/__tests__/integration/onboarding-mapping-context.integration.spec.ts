// LAYER: Infrastructure / Integration Tests
// Real persistence reproduction of A/C/D; external spreadsheet/messaging are mocked.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import * as schema from '../../infrastructure/db/schema';
import { DrizzleSpreadsheetConfigRepository } from '../../infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository';
import { DrizzleColumnMappingRepository } from '../../infrastructure/db/repositories/DrizzleColumnMappingRepository';
import { DrizzleConversationStateRepository } from '../../infrastructure/db/repositories/DrizzleConversationStateRepository';
import { DrizzleCategoryVocabularyRepository } from '../../infrastructure/db/repositories/DrizzleCategoryVocabularyRepository';
import { DrizzleAccountDeletionRepository } from '../../infrastructure/db/repositories/DrizzleAccountDeletionRepository';
import { ConfirmColumnMapping } from '../../application/use-cases/spreadsheet/ConfirmColumnMapping';
import { DetectCategories } from '../../application/use-cases/spreadsheet/DetectCategories';
import { ConfirmCategories } from '../../application/use-cases/spreadsheet/ConfirmCategories';
import { DetectPaymentMethods } from '../../application/use-cases/spreadsheet/DetectPaymentMethods';
import { TransitionConversationState } from '../../application/use-cases/conversation/TransitionConversationState';

const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;

describePostgres('onboarding confirmed mapping context (PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer;
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    sql = postgres(container.getConnectionUri(), { max: 1 });
    db = drizzle(sql, { schema });
    await migrate(db, {
      migrationsFolder: path.resolve(__dirname, '../../infrastructure/db/migrations'),
    });
  });
  afterAll(async () => {
    if (sql) await sql.end();
    if (container) await container.stop();
  });

  async function register() {
    const userId = randomUUID();
    await db.insert(schema.users).values({ userId, status: 'onboarding' });
    return userId;
  }

  async function review(userId: string, fileId = 'file-1') {
    const configs = new DrizzleSpreadsheetConfigRepository(db);
    const mappings = new DrizzleColumnMappingRepository(db);
    const states = new DrizzleConversationStateRepository(db);
    const vocabulary = new DrizzleCategoryVocabularyRepository(db);
    const transition = new TransitionConversationState(states);
    const config = await configs.createOrResumeInitial({
      userId,
      provider: 'google',
      fileId,
      fileName: 'Expenses',
      sheetName: 'Gastos',
      accessVerifiedAt: new Date(),
      categoriesConfirmedAt: null,
    });
    const proposalId = randomUUID();
    await db
      .insert(schema.conversationStates)
      .values({ userId, currentState: 'ONBOARDING_MAPPING' })
      .onConflictDoUpdate({
        target: schema.conversationStates.userId,
        set: { currentState: 'ONBOARDING_MAPPING' },
      });
    const input = {
      userId,
      externalId: 'chat',
      channel: 'telegram' as const,
      statePayload: {
        spreadsheetId: config.id,
        provider: config.provider,
        fileId,
        sheetName: 'Gastos',
        headerRowIndex: 2,
        proposalId,
        mappings: [
          { gasttoField: 'medio_pago', columnIndex: 0, columnHeader: 'Pago' },
          { gasttoField: 'categoria', columnIndex: 2, columnHeader: 'Categoría' },
          { gasttoField: 'subcategoria', columnIndex: 3, columnHeader: 'Subcategoría' },
        ],
      },
    };
    await db
      .update(schema.conversationStates)
      .set({ statePayload: input.statePayload })
      .where(eq(schema.conversationStates.userId, userId));
    const sendMessage = vi.fn().mockResolvedValue({ status: 'success' as const });
    const messagingPort = { sendMessage };
    const confirm = new ConfirmColumnMapping({
      spreadsheetConfigRepository: configs,
      columnMappingRepository: mappings,
      correctionStateRepository: { clear: vi.fn(), load: vi.fn(), save: vi.fn() },
      messagingPort,
      transitionState: transition,
    });
    const confirmed = await transition.runForUser(userId, () => confirm.execute(input));
    expect(confirmed.payload).toMatchObject({
      spreadsheetId: config.id,
      proposalId,
      headerRowIndex: 2,
    });
    const rows = await mappings.findBySpreadsheetId(config.id);
    expect(rows.map((row) => [row.GasttoField, row.columnIndex])).toEqual([
      ['medio_pago', 0],
      ['categoria', 2],
      ['subcategoria', 3],
    ]);
    expect(rows.every((row) => row.confirmedAt !== null && row.spreadsheetId === config.id)).toBe(
      true,
    );
    const readHierarchy = vi.fn().mockResolvedValue({
      categories: ['Comida'],
      pairs: [{ category: 'Comida', subcategory: 'Restaurante' }],
      orphanSubcategories: [],
    });
    const tokens = {
      getValidAccessToken: vi.fn().mockResolvedValue({ accessToken: 'mock-token' }),
      forceRefreshAccessToken: vi.fn(),
    };
    const detect = new DetectCategories({
      spreadsheetConfigRepository: configs,
      columnMappingRepository: mappings,
      categoryVocabularyRepository: vocabulary,
      messagingPort,
      transitionState: transition,
      oauthAccessTokenService: tokens,
      categoryReaderPortFactory: { create: vi.fn() },
      categoryHierarchyReaderPortFactory: { create: () => ({ readHierarchy }) },
    });
    const detected = await transition.runForUser(userId, () =>
      detect.execute({ ...input, statePayload: confirmed.payload! }),
    );
    expect(detected.kind).toBe('proposal');
    expect(readHierarchy).toHaveBeenCalledWith(fileId, 2, 3, 'Gastos', 3);
    expect(sendMessage).toHaveBeenLastCalledWith('chat', expect.stringContaining('Restaurante'));
    const getUniqueValues = vi.fn().mockResolvedValue(['Visa']);
    const commit = vi.fn();
    const categoryConfirmation = new ConfirmCategories({
      spreadsheetConfigRepository: configs,
      columnMappingRepository: mappings,
      categoryVocabularyRepository: vocabulary,
      userRepository: { updateStatus: vi.fn() } as never,
      messagingPort,
      transitionState: transition,
      onboardingCommit: { execute: commit },
      detectPaymentMethods: new DetectPaymentMethods({
        tokenService: tokens,
        spreadsheetPortFactory: { create: vi.fn().mockReturnValue({ getUniqueValues }) },
      }),
    });
    const draft = (await states.findByUserId(userId))!.statePayload;
    await transition.runForUser(userId, () =>
      categoryConfirmation.execute({ ...input, statePayload: draft }),
    );
    expect(getUniqueValues).toHaveBeenCalledWith(fileId, 0, 'Gastos', 3);
    const payment = (await states.findByUserId(userId))!.statePayload;
    expect(payment).toMatchObject({
      spreadsheetId: config.id,
      proposalId,
      confirmedMappings: confirmed.payload!.confirmedMappings,
      paymentMethods: ['Visa'],
      paymentColumnMapped: true,
      paymentReview: true,
    });
    expect(commit).not.toHaveBeenCalled();
    return {
      config,
      mappings,
      states,
      transition,
      detect,
      categoryConfirmation,
      input,
      payment,
      getUniqueValues,
      commit,
      sendMessage,
    };
  }

  it('retains A/C/D in fresh registration and repeated setup, including a changed incomplete destination', async () => {
    const userId = await register();
    const first = await review(userId);
    const repeated = await review(userId);
    expect(repeated.config.id).toBe(first.config.id);
    const changed = await review(userId, 'file-2');
    expect(changed.config.id).toBe(first.config.id);
    expect(changed.config.fileId).toBe('file-2');
  });

  it('retains A/C/D after storage erasure and fresh registration with new configuration identity', async () => {
    const oldUserId = await register();
    const old = await review(oldUserId);
    await new DrizzleAccountDeletionRepository(db).eraseAccount(oldUserId);
    expect(await old.mappings.findBySpreadsheetId(old.config.id)).toEqual([]);
    const userId = await register();
    const fresh = await review(userId);
    expect(userId).not.toBe(oldUserId);
    expect(fresh.config.id).not.toBe(old.config.id);
  });

  it('recovers unexpected payment mapping loss before final activation or local-only messaging', async () => {
    const userId = await register();
    const flow = await review(userId);
    await db
      .delete(schema.columnMappings)
      .where(eq(schema.columnMappings.spreadsheetId, flow.config.id));
    const result = await flow.transition.runForUser(userId, () =>
      flow.categoryConfirmation.execute({ ...flow.input, statePayload: flow.payment }),
    );
    expect(result.nextState).toBe('ONBOARDING_MAPPING');
    expect(flow.commit).not.toHaveBeenCalled();
    expect((await flow.states.findByUserId(userId))!.statePayload).not.toHaveProperty('categories');
    expect(flow.sendMessage).not.toHaveBeenCalledWith(
      'chat',
      expect.stringContaining('¡Todo listo!'),
    );
  });
  it('rejects a stale proposal passed into a current execution without changing the draft', async () => {
    const userId = await register();
    const flow = await review(userId);
    const before = await flow.states.findByUserId(userId);
    const calls = flow.sendMessage.mock.calls.length;
    await expect(
      flow.transition.runForUser(userId, () =>
        flow.categoryConfirmation.execute({
          ...flow.input,
          statePayload: { ...flow.payment, proposalId: 'older-proposal' },
        }),
      ),
    ).rejects.toHaveProperty('name', 'StaleConversationStateError');
    expect(await flow.states.findByUserId(userId)).toEqual(before);
    expect(flow.sendMessage).toHaveBeenCalledTimes(calls);
    expect(flow.commit).not.toHaveBeenCalled();
  });

  it('does not let stale or expired recovery overwrite a newer proposal', async () => {
    const userId = await register();
    const flow = await review(userId);
    const observed = (await flow.states.findByUserId(userId))!;
    await flow.transition.runForUser(userId, () =>
      flow.transition.execute({
        userId,
        targetState: 'ONBOARDING_CATEGORIES',
        payload: { ...flow.payment, proposalId: 'newer-proposal' },
      }),
    );
    const newer = await flow.states.findByUserId(userId);
    await db
      .delete(schema.columnMappings)
      .where(eq(schema.columnMappings.spreadsheetId, flow.config.id));
    const calls = flow.sendMessage.mock.calls.length;
    await expect(
      flow.transition.runWithState(observed, () =>
        flow.detect.execute({
          ...flow.input,
          statePayload: observed.statePayload,
        }),
      ),
    ).rejects.toHaveProperty('name', 'StaleConversationStateError');
    expect(await flow.states.findByUserId(userId)).toEqual(newer);
    expect(flow.sendMessage).toHaveBeenCalledTimes(calls);
    await db
      .update(schema.conversationStates)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.conversationStates.userId, userId));
    await expect(
      flow.transition.runForUser(userId, async () =>
        flow.detect.execute({
          ...flow.input,
          statePayload: (await flow.states.findByUserId(userId))!.statePayload,
        }),
      ),
    ).rejects.toHaveProperty('name', 'StaleConversationStateError');
    expect(flow.sendMessage).toHaveBeenCalledTimes(calls);
    expect((await flow.states.findByUserId(userId))!.currentState).toBe('ONBOARDING_CATEGORIES');
  });
});
