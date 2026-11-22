import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as schema from '../../src/infrastructure/db/schema';
import {
  startDbContainer,
  stopDbContainer,
  getConnectionString,
  isDockerAvailable,
} from './helpers/db-container';
import { runMigrations } from './helpers/migrate';
import {
  createUser,
  createMessagingIdentity,
  createOAuthToken,
  createSpreadsheetConfig,
} from './helpers/fixtures';
import { DrizzleAccountDeletionRepository } from '../../src/infrastructure/db/repositories/DrizzleAccountDeletionRepository';
import { DrizzleAccountExternalWorkFence } from '../../src/infrastructure/db/repositories/DrizzleAccountExternalWorkFence';
import { DrizzleOAuthTokenRepository } from '../../src/infrastructure/db/repositories/DrizzleOAuthTokenRepository';
import { OAuthAccessTokenService } from '../../src/application/services/OAuthAccessTokenService';
import { DrizzleStartReplayGuard } from '../../src/infrastructure/db/repositories/DrizzleStartReplayGuard';
import { AccountDeletionInProgressError } from '../../src/application/ports/AccountExternalWorkFence';
import { AccountOperationalCleanup } from '../../src/infrastructure/redis/AccountOperationalCleanup';
import { RedisUserProcessingLock } from '../../src/infrastructure/redis/RedisUserProcessingLock';
import { RedisRestoreGuard } from '../../src/infrastructure/redis/RedisRestoreGuard';
import { RedisRestoreInventory } from '../../src/infrastructure/redis/RedisRestoreInventory';
import { RevokeAccountCredentials } from '../../src/application/use-cases/user/RevokeAccountCredentials';
import { AccountDeletionService } from '../../src/application/services/AccountDeletionService';
import { RedisProcessedMessageRepository } from '../../src/infrastructure/redis/RedisProcessedMessageRepository';
import { ProcessedMessageKey } from '../../src/domain/value-objects/ProcessedMessageKey';
import type { TokenEncryptionPort } from '../../src/domain/ports/tokenEncryption';
import type { OAuthServicePort } from '../../src/domain/ports/oauth';

describe.skipIf(!isDockerAvailable())('Complete account deletion with PostgreSQL and Redis', () => {
  let pg: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  let sql: postgres.Sql;
  let redis: Redis;
  let incoming: Queue;
  let processing: Queue;
  let reminders: Queue;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    [pg, redisContainer] = await Promise.all([
      startDbContainer(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);
    sql = postgres(getConnectionString(pg), { max: 1 });
    redis = new Redis(redisContainer.getMappedPort(6379), redisContainer.getHost());
    await Promise.all([runMigrations(sql), redis.ping()]);
    db = drizzle(sql, { schema });
    incoming = new Queue('deletion-flow-incoming', { connection: redis });
    processing = new Queue('deletion-flow-processing', { connection: redis });
    reminders = new Queue('deletion-flow-reminders', { connection: redis });
  }, 120_000);

  afterAll(async () => {
    await Promise.all([incoming?.close(), processing?.close(), reminders?.close()]);
    redis?.disconnect();
    if (sql) await sql.end();
    await Promise.all([pg && stopDbContainer(pg), redisContainer?.stop()]);
  });

  it('removes one account and all owned payloads while preserving another account and external Sheets', async () => {
    const owner = await createUser(db);
    const other = await createUser(db);
    await createMessagingIdentity(db, { userId: owner.userId, externalId: 'delete-chat' });
    await createMessagingIdentity(db, { userId: other.userId, externalId: 'keep-chat' });
    await createOAuthToken(db, { userId: owner.userId });
    await createOAuthToken(db, { userId: other.userId });
    await db.insert(schema.conversationStates).values({
      userId: owner.userId,
      currentState: 'IDLE',
      statePayload: { note: 'private conversation' },
    });
    await db.insert(schema.conversationStates).values({
      userId: other.userId,
      currentState: 'IDLE',
    });
    const [request] = await db
      .insert(schema.accessRequests)
      .values({
        userId: owner.userId,
        email: 'owner@example.test',
        kind: 'replacement',
        status: 'pending',
      })
      .returning();
    if (!request) throw new Error('Missing access request fixture');
    await db.insert(schema.candidateOAuthTokens).values({
      requestId: request.id,
      userId: owner.userId,
      accessTokenEnc: Buffer.from('candidate-access'),
      refreshTokenEnc: Buffer.from('candidate-refresh'),
      iv: Buffer.from('candidate-access-iv'),
      refreshIv: Buffer.from('candidate-refresh-iv'),
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      scope: [],
    });
    const config = await createSpreadsheetConfig(db, { userId: owner.userId });
    const [historical] = await db
      .insert(schema.spreadsheetConfigs)
      .values({
        userId: owner.userId,
        provider: 'google',
        fileId: 'historical-file',
        fileName: 'Historical',
        sheetName: 'Gastos',
        isActive: false,
        accessVerifiedAt: new Date(),
      })
      .returning();
    if (!historical) throw new Error('Missing historical configuration fixture');
    await db.insert(schema.columnMappings).values({
      spreadsheetId: historical.id,
      gasttoField: 'monto',
      columnIndex: 1,
      columnHeader: 'Amount',
    });
    const [category] = await db
      .insert(schema.userCategories)
      .values({
        spreadsheetId: historical.id,
        rawValue: 'Archived',
        normalizedValue: 'archived',
        isActive: false,
      })
      .returning();
    if (!category) throw new Error('Missing category fixture');
    await db.insert(schema.userSubcategories).values({
      categoryId: category.id,
      rawValue: 'Old',
      normalizedValue: 'old',
      isActive: false,
    });
    await db.insert(schema.userPaymentMethods).values({
      spreadsheetId: historical.id,
      displayName: 'Old card',
      normalizedName: 'old card',
      isActive: false,
    });
    await db.insert(schema.expenseQueue).values({
      userId: owner.userId,
      position: 1,
      rawMessage: 'Queued expense',
      channel: 'telegram',
    });
    await db.insert(schema.operationLogs).values({
      userId: owner.userId,
      operation: 'EXPENSE_SAVE_FAILED',
      payload: { rawMessage: 'Expense 9' },
    });
    await db.insert(schema.expenseRecords).values({
      userId: owner.userId,
      spreadsheetId: config.id,
      concepto: 'Expense',
      monto: '9.00',
      moneda: 'EUR',
      fechaGasto: '2026-11-17',
      sheetName: 'Gastos',
      rawMessage: 'Expense 9',
      isDeleted: true,
      deletedAt: new Date(),
    });
    const ownedIncoming = await incoming.add('message', {
      channel: 'telegram',
      chatId: 'delete-chat',
      rawPayload: { text: 'Expense 9' },
    });
    const otherIncoming = await incoming.add('message', {
      channel: 'telegram',
      chatId: 'keep-chat',
    });
    const ownedProcessing = await processing.add('message', {
      userId: owner.userId,
      rawMessage: 'Expense 9',
    });
    const ownedPrioritized = await processing.add(
      'priority-message',
      { userId: owner.userId },
      { priority: 1 },
    );
    const otherProcessing = await processing.add('message', { userId: other.userId });
    const otherPrioritized = await processing.add(
      'priority-message',
      { userId: other.userId },
      { priority: 1 },
    );
    const ownedReminder = await reminders.add(
      'oauth-reminder',
      { userId: owner.userId },
      { delay: 60_000 },
    );
    const otherReminder = await reminders.add('oauth-reminder', { userId: other.userId });
    await redis.set('identity:telegram:delete-chat', owner.userId);
    await redis.set('identity:telegram:keep-chat', other.userId);
    await redis.set(`conversation:${owner.userId}:mapping-correction`, 'owner state');
    await redis.set(`conversation:${other.userId}:mapping-correction`, 'other state');
    const marker = new ProcessedMessageKey({
      channel: 'telegram',
      externalIdentityId: 'delete-chat',
      externalMessageId: 'message-1',
    });
    const processed = new RedisProcessedMessageRepository(redis);
    await processed.markAsProcessed(marker, owner.userId);
    expect(await processed.exists(marker)).toBe(true);
    const otherMarker = new ProcessedMessageKey({
      channel: 'telegram',
      externalIdentityId: 'keep-chat',
      externalMessageId: 'message-1',
    });
    await processed.markAsProcessed(otherMarker, other.userId);
    await redis.set(
      'oauth:state:delete',
      JSON.stringify({ userId: owner.userId, externalId: 'delete-chat' }),
    );
    await redis.set('oauth:state:keep', JSON.stringify({ userId: other.userId }));
    const repo = new DrizzleAccountDeletionRepository(db);
    expect(await repo.begin(owner.userId)).toBe(true);
    const revokeToken = vi.fn().mockResolvedValue('not_confirmed');
    const sendMessage = vi.fn().mockResolvedValue({ status: 'success' });
    const credentials = new RevokeAccountCredentials(
      repo,
      { decrypt: vi.fn().mockReturnValue('refresh-token') } as unknown as TokenEncryptionPort,
      { revokeToken },
    );
    const service = new AccountDeletionService(
      repo,
      credentials,
      new AccountOperationalCleanup(redis, incoming, processing, reminders),
      new RedisUserProcessingLock(redis),
      { sendMessage },
      new RedisRestoreGuard(db, redis),
    );
    await service.resume(owner.userId);
    await service.resume(owner.userId);
    expect(revokeToken).toHaveBeenCalledTimes(2);
    expect(revokeToken).toHaveBeenCalledWith('google', 'refresh-token');
    expect(sendMessage).toHaveBeenCalledWith(
      'delete-chat',
      expect.stringContaining('no pudo confirmar la revocación'),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'delete-chat',
      expect.stringContaining('La eliminación no modificó tu hoja de cálculo.'),
    );
    expect(
      await db.select().from(schema.users).where(eq(schema.users.userId, owner.userId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.users).where(eq(schema.users.userId, other.userId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.conversationStates)
        .where(eq(schema.conversationStates.userId, other.userId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.userId, other.userId)),
    ).toHaveLength(1);
    for (const table of [
      schema.messagingIdentities,
      schema.accessRequests,
      schema.conversationStates,
      schema.expenseQueue,
      schema.oauthTokens,
      schema.candidateOAuthTokens,
      schema.spreadsheetConfigs,
      schema.operationLogs,
    ] as const) {
      const rows = await db.select().from(table).where(eq(table.userId, owner.userId));
      expect(rows).toHaveLength(0);
    }
    expect(
      await db
        .select()
        .from(schema.columnMappings)
        .where(eq(schema.columnMappings.spreadsheetId, historical.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.userCategories)
        .where(eq(schema.userCategories.spreadsheetId, historical.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.userSubcategories)
        .where(eq(schema.userSubcategories.categoryId, category.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.userPaymentMethods)
        .where(eq(schema.userPaymentMethods.spreadsheetId, historical.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.expenseRecords)
        .where(eq(schema.expenseRecords.userId, owner.userId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.userId, owner.userId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.candidateOAuthTokens)
        .where(eq(schema.candidateOAuthTokens.userId, owner.userId)),
    ).toHaveLength(0);
    expect(await incoming.getJob(ownedIncoming.id!)).toBeUndefined();
    expect(await processing.getJob(ownedProcessing.id!)).toBeUndefined();
    expect(await processing.getJob(ownedPrioritized.id!)).toBeUndefined();
    expect(await reminders.getJob(ownedReminder.id!)).toBeUndefined();
    expect(await incoming.getJob(otherIncoming.id!)).toBeDefined();
    expect(await processing.getJob(otherProcessing.id!)).toBeDefined();
    expect(await processing.getJob(otherPrioritized.id!)).toBeDefined();
    expect(await reminders.getJob(otherReminder.id!)).toBeDefined();
    const retainedStates = [
      'waiting',
      'prioritized',
      'delayed',
      'paused',
      'completed',
      'failed',
      'waiting-children',
      'active',
    ] as const;
    const [incomingJobs, processingJobs, reminderJobs] = await Promise.all([
      incoming.getJobs([...retainedStates], 0, -1),
      processing.getJobs([...retainedStates], 0, -1),
      reminders.getJobs([...retainedStates], 0, -1),
    ]);
    expect(
      incomingJobs.filter(
        (job) => job.data.chatId === 'delete-chat' || job.data.userId === owner.userId,
      ),
    ).toEqual([]);
    expect(processingJobs.filter((job) => job.data.userId === owner.userId)).toEqual([]);
    expect(reminderJobs.filter((job) => job.data.userId === owner.userId)).toEqual([]);
    expect(await redis.get('identity:telegram:delete-chat')).toBeNull();
    expect(await redis.get('identity:telegram:keep-chat')).toBe(other.userId);
    expect(await redis.get(`conversation:${owner.userId}:mapping-correction`)).toBeNull();
    expect(await redis.get(`conversation:${other.userId}:mapping-correction`)).toBe('other state');
    expect(await processed.exists(marker)).toBe(false);
    expect(await processed.exists(otherMarker)).toBe(true);
    expect(await redis.exists(`processed_message:owner:${owner.userId}`)).toBe(0);
    expect(await redis.exists(`processed_message:owner:${other.userId}`)).toBe(1);
    expect(await redis.get('oauth:state:delete')).toBeNull();
    expect(await redis.get('oauth:state:keep')).toBe(JSON.stringify({ userId: other.userId }));
    expect(await repo.get(owner.userId)).toBeNull();
    expect(
      await db
        .select()
        .from(schema.accountDeletionIdentities)
        .where(eq(schema.accountDeletionIdentities.userId, owner.userId)),
    ).toHaveLength(0);
  });

  it('keeps the account and deletion barrier until an active job settles', async () => {
    const owner = await createUser(db);
    await createMessagingIdentity(db, { userId: owner.userId, externalId: 'active-chat' });
    const repo = new DrizzleAccountDeletionRepository(db);
    expect(await repo.begin(owner.userId)).toBe(true);
    const activeProcessing = new Queue('deletion-flow-active', { connection: redis });
    const workerConnection = new Redis(
      redisContainer.getMappedPort(6379),
      redisContainer.getHost(),
      {
        maxRetriesPerRequest: null,
      },
    );

    let signalStarted!: () => void;
    let finishJob!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      finishJob = resolve;
    });
    const worker = new Worker(
      'deletion-flow-active',
      async () => {
        signalStarted();
        await finished;
      },
      { connection: workerConnection, concurrency: 1 },
    );
    try {
      const active = await activeProcessing.add('active-message', { userId: owner.userId });
      await started;
      expect(await active.getState()).toBe('active');

      const service = new AccountDeletionService(
        repo,
        new RevokeAccountCredentials(repo, { decrypt: vi.fn() } as unknown as TokenEncryptionPort, {
          revokeToken: vi.fn(),
        }),
        new AccountOperationalCleanup(redis, incoming, activeProcessing, reminders),
        new RedisUserProcessingLock(redis),
        { sendMessage: vi.fn().mockResolvedValue({ status: 'success' }) },
        new RedisRestoreGuard(db, redis),
      );
      await expect(service.resume(owner.userId)).rejects.toThrow('ACCOUNT_JOB_STILL_ACTIVE');
      expect(
        await db.select().from(schema.users).where(eq(schema.users.userId, owner.userId)),
      ).toHaveLength(1);
      expect(await repo.get(owner.userId)).toMatchObject({ stage: 'cleaning' });

      finishJob();
      await vi.waitFor(async () => {
        expect(await active.getState()).toBe('completed');
      });
      await service.resume(owner.userId);
      expect(
        await db.select().from(schema.users).where(eq(schema.users.userId, owner.userId)),
      ).toHaveLength(0);
      expect(await activeProcessing.getJob(active.id!)).toBeUndefined();
      expect(await repo.get(owner.userId)).toBeNull();
    } finally {
      finishJob();
      await worker.close();
      await activeProcessing.close();
      workerConnection.disconnect();
    }
  });

  it('opens the barrier while retaining an active effect and refuses erasure until it settles', async () => {
    const owner = await createUser(db);
    const fenceSql = postgres(getConnectionString(pg), { max: 1 });
    const fence = new DrizzleAccountExternalWorkFence(drizzle(fenceSql, { schema }));
    const repo = new DrizzleAccountDeletionRepository(db);
    const sheets = {
      appendRow: vi.fn().mockResolvedValue({ sheet: 'Gastos', row: 2 }),
      deleteRow: vi.fn(),
    };
    const service = new AccountDeletionService(
      repo,
      new RevokeAccountCredentials(repo, { decrypt: vi.fn() } as unknown as TokenEncryptionPort, {
        revokeToken: vi.fn(),
      }),
      new AccountOperationalCleanup(redis, incoming, processing, reminders),
      new RedisUserProcessingLock(redis),
      { sendMessage: vi.fn() },
      new RedisRestoreGuard(db, redis),
    );
    let signalStarted!: () => void;
    let releaseEffect!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const effectFinished = new Promise<void>((resolve) => {
      releaseEffect = resolve;
    });
    const effect = fence.run(owner.userId, async () => {
      signalStarted();
      await effectFinished;
      await sheets.appendRow('file', 'Gastos', ['existing expense']);
      return 'settled';
    });
    await started;

    try {
      expect(await repo.begin(owner.userId)).toBe(true);
      await expect(repo.assertWorkDrained(owner.userId)).rejects.toThrow(
        'ACCOUNT_EXTERNAL_WORK_STILL_ACTIVE',
      );
      await expect(repo.eraseAccount(owner.userId)).rejects.toThrow(
        'ACCOUNT_EXTERNAL_WORK_STILL_ACTIVE',
      );
      await expect(service.resume(owner.userId)).rejects.toThrow(
        'ACCOUNT_EXTERNAL_WORK_STILL_ACTIVE',
      );
      expect(sheets.appendRow).not.toHaveBeenCalled();
      expect(sheets.deleteRow).not.toHaveBeenCalled();
      const lateEffect = vi.fn(() => sheets.appendRow('file', 'Gastos', ['late expense']));
      await expect(fence.run(owner.userId, lateEffect)).rejects.toBeInstanceOf(
        AccountDeletionInProgressError,
      );
      expect(lateEffect).not.toHaveBeenCalled();
      releaseEffect();
      expect(await effect).toBe('settled');
      await expect(repo.assertWorkDrained(owner.userId)).resolves.toBeUndefined();
      expect(sheets.appendRow).toHaveBeenCalledOnce();
      await service.resume(owner.userId);
      expect(sheets.appendRow).toHaveBeenCalledOnce();
      expect(sheets.deleteRow).not.toHaveBeenCalled();
      expect(await repo.get(owner.userId)).toBeNull();
    } finally {
      releaseEffect();
      await Promise.allSettled([effect]);
      await fenceSql.end();
    }
  });

  it('keeps erasure blocked when the work connection disappears before release', async () => {
    const owner = await createUser(db);
    const fenceSql = postgres(getConnectionString(pg), { max: 1 });
    const fence = new DrizzleAccountExternalWorkFence(drizzle(fenceSql, { schema }));
    const deletion = new DrizzleAccountDeletionRepository(db);
    let signalStarted!: () => void;
    let releaseEffect!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseEffect = resolve;
    });
    const effect = fence.run(owner.userId, async () => {
      signalStarted();
      await blocked;
    });
    await started;
    try {
      // The durable count survives the loss of the pool that registered work.
      await fenceSql.end();
      expect(await deletion.begin(owner.userId)).toBe(true);
      await expect(deletion.assertWorkDrained(owner.userId)).rejects.toThrow(
        'ACCOUNT_EXTERNAL_WORK_STILL_ACTIVE',
      );
      releaseEffect();
      await expect(effect).rejects.toThrow();
      await expect(deletion.eraseAccount(owner.userId)).rejects.toThrow(
        'ACCOUNT_EXTERNAL_WORK_STILL_ACTIVE',
      );
      expect(
        await db.select().from(schema.users).where(eq(schema.users.userId, owner.userId)),
      ).toHaveLength(1);
    } finally {
      releaseEffect();
      await Promise.allSettled([effect]);
    }
  });

  it('reuses an active account fence for nested refresh work with a one-connection pool', async () => {
    const owner = await createUser(db);
    const fenceSql = postgres(getConnectionString(pg), { max: 1 });
    const fence = new DrizzleAccountExternalWorkFence(drizzle(fenceSql, { schema }));
    const nestedWork = vi.fn().mockResolvedValue('refreshed');
    try {
      await expect(
        fence.run(owner.userId, () => fence.run(owner.userId, nestedWork)),
      ).resolves.toBe('refreshed');
      expect(nestedWork).toHaveBeenCalledOnce();

      expect(await new DrizzleAccountDeletionRepository(db).begin(owner.userId)).toBe(true);
      await expect(fence.run(owner.userId, nestedWork)).rejects.toBeInstanceOf(
        AccountDeletionInProgressError,
      );
      expect(nestedWork).toHaveBeenCalledOnce();
    } finally {
      await fenceSql.end();
    }
  });

  it('opens the barrier during OAuth refresh but blocks completion and token reuse', async () => {
    const owner = await createUser(db);
    await createOAuthToken(db, {
      userId: owner.userId,
      accessTokenExpiresAt: new Date(0),
    });
    const fenceSql = postgres(getConnectionString(pg), { max: 1 });
    const barrierSql = postgres(getConnectionString(pg), { max: 1 });
    const fence = new DrizzleAccountExternalWorkFence(drizzle(fenceSql, { schema }));
    const deletion = new DrizzleAccountDeletionRepository(drizzle(barrierSql, { schema }));
    let signalStarted!: () => void;
    let releaseRefresh!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const providerReleased = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshAccessToken = vi.fn(async () => {
      signalStarted();
      await providerReleased;
      return { accessToken: 'new-access', expiresAt: new Date(Date.now() + 3600_000), scope: [] };
    });
    const tokenService = new OAuthAccessTokenService({
      tokenRepository: new DrizzleOAuthTokenRepository(db),
      tokenEncryption: {
        decrypt: () => 'refresh-secret',
        encrypt: () => ({ ciphertext: Buffer.from('new-access'), iv: Buffer.from('new-iv') }),
      } as unknown as TokenEncryptionPort,
      oauthService: { refreshAccessToken } as unknown as OAuthServicePort,
      accountDeletion: new DrizzleAccountDeletionRepository(db),
      accountExternalWorkFence: fence,
    });
    const refresh = tokenService.getValidAccessToken({ userId: owner.userId, provider: 'google' });
    await started;
    try {
      expect(await deletion.begin(owner.userId)).toBe(true);
      await expect(deletion.assertWorkDrained(owner.userId)).rejects.toThrow(
        'ACCOUNT_EXTERNAL_WORK_STILL_ACTIVE',
      );
      releaseRefresh();
      await expect(refresh).rejects.toMatchObject({ code: 'AUTH_ERROR' });
      await expect(deletion.assertWorkDrained(owner.userId)).resolves.toBeUndefined();
      expect(refreshAccessToken).toHaveBeenCalledOnce();
    } finally {
      releaseRefresh();
      await Promise.allSettled([refresh]);
      await fenceSql.end();
      await barrierSql.end();
    }
  });

  it('retains a bounded /start receipt after account erasure and admits a fresh command', async () => {
    const owner = await createUser(db);
    await createMessagingIdentity(db, { userId: owner.userId, externalId: 'replay-chat' });
    const guard = new DrizzleStartReplayGuard(db, 'integration-replay-key');
    expect(await guard.claim('replay-chat', 'old-message')).toBe(true);
    expect(
      await new DrizzleStartReplayGuard(db, 'integration-replay-key').claim(
        'replay-chat',
        'old-message',
      ),
    ).toBe(false);

    const repo = new DrizzleAccountDeletionRepository(db);
    expect(await repo.begin(owner.userId)).toBe(true);
    await repo.eraseAccount(owner.userId);
    await repo.finish(owner.userId);
    expect(await guard.claim('replay-chat', 'old-message')).toBe(false);
    expect(await guard.claim('replay-chat', 'fresh-message')).toBe(true);

    const rows = await db.select().from(schema.accountStartReplays);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.digest))).toBe(true);
    expect(rows.every((row) => row.expiresAt > new Date())).toBe(true);
    await db.update(schema.accountStartReplays).set({ expiresAt: new Date(0) });
    await guard.pruneExpired();
    expect(await db.select().from(schema.accountStartReplays)).toHaveLength(0);
  });

  it('quarantines an older Redis epoch and a changed Valkey server run ID', async () => {
    const guard = new RedisRestoreGuard(db, redis);
    await guard.assertCurrent();
    await guard.recordCleanup();
    const [row] = await db.select().from(schema.redisRecoveryEpoch);
    if (!row) throw new Error('Missing recovery epoch');
    const markerKey = 'gastto:redis-recovery-epoch';
    await redis.set(markerKey, String(row.epoch - 1));
    await expect(guard.assertCurrent()).rejects.toThrow('REDIS_RESTORE_QUARANTINE');
    await redis.set(markerKey, String(row.epoch));
    await db
      .update(schema.redisRecoveryEpoch)
      .set({ runId: 'older-valkey-process' })
      .where(eq(schema.redisRecoveryEpoch.id, 1));
    try {
      await expect(guard.assertCurrent()).rejects.toThrow('REDIS_RESTORE_QUARANTINE');
    } finally {
      await db
        .update(schema.redisRecoveryEpoch)
        .set({ runId: row.runId })
        .where(eq(schema.redisRecoveryEpoch.id, 1));
    }
    await expect(guard.assertCurrent()).resolves.toBeUndefined();
  });

  it('inventories restored account work without exposing identifiers or changing Redis', async () => {
    const owner = await createUser(db);
    await createMessagingIdentity(db, { userId: owner.userId, externalId: 'inventory-live-chat' });
    const orphanId = '00000000-0000-4000-8000-000000000123';
    const queue = new Queue('incoming-message', { connection: redis });
    const keys = [
      'identity:telegram:inventory-live-chat',
      'identity:telegram:inventory-orphan-chat',
      `conversation:${orphanId}:mapping-correction`,
      `processed_message:owner:${orphanId}`,
      'processed_message:telegram:inventory-orphan',
      'processed_message:telegram:inventory-unowned',
      'oauth:state:inventory-orphan',
      'oauth:state:inventory-unknown',
    ];
    try {
      const payload = {
        messageType: 'TEXT',
        channel: 'telegram',
        timestamp: new Date().toISOString(),
        externalMessageId: 'inventory-message',
      };
      await queue.add('live', { ...payload, userId: owner.userId, chatId: 'inventory-live-chat' });
      await queue.add('orphan', { ...payload, userId: orphanId, chatId: 'inventory-orphan-chat' });
      await redis.set(keys[0]!, owner.userId);
      await redis.set(keys[1]!, orphanId);
      await redis.set(keys[2]!, '{}');
      await redis.sadd(keys[3]!, keys[4]!);
      await redis.set(keys[4]!, '1');
      await redis.set(keys[5]!, '1');
      await redis.set(keys[6]!, JSON.stringify({ userId: orphanId }));
      await redis.set(keys[7]!, '{broken');
      const report = await new RedisRestoreInventory(db, redis, [
        { name: 'incoming-message', queue },
      ]).inspect();
      expect(report.jobs).toMatchObject({ orphan: 1, uncertain: 1, active: 0 });
      expect(report.jobDecisions['incoming-message']).toMatchObject({ orphaned: 1, unresolved: 1 });
      expect(report.identityCaches.current).toBeGreaterThanOrEqual(1);
      expect(report.identityCaches.orphan).toBeGreaterThanOrEqual(1);
      expect(report.correctionStates.orphan).toBeGreaterThanOrEqual(1);
      expect(report.processedOwnerIndexes.orphan).toBeGreaterThanOrEqual(1);
      expect(report.processedMarkersWithoutOwner).toBeGreaterThanOrEqual(1);
      expect(report.oauthStates.orphan).toBeGreaterThanOrEqual(1);
      expect(report.oauthStates.uncertain).toBeGreaterThanOrEqual(1);
      expect(report.safeToResume).toBe(false);
      expect(JSON.stringify(report)).not.toContain(owner.userId);
      expect(JSON.stringify(report)).not.toContain(orphanId);
      expect(await queue.getJobCounts('waiting')).toMatchObject({ waiting: 2 });
      expect(await redis.get(keys[1]!)).toBe(orphanId);
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
      await redis.del(...keys);
    }
  });
});
