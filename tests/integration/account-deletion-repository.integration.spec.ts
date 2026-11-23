import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Redis } from 'ioredis';
import * as schema from '../../src/infrastructure/db/schema';
import { DrizzleAccountDeletionRepository } from '../../src/infrastructure/db/repositories/DrizzleAccountDeletionRepository';
import { DrizzleUserRepository } from '../../src/infrastructure/db/repositories/DrizzleUserRepository';
import { DrizzleOAuthTokenRepository } from '../../src/infrastructure/db/repositories/DrizzleOAuthTokenRepository';
import { DrizzleCandidateOAuthTokenRepository } from '../../src/infrastructure/db/repositories/DrizzleCandidateOAuthTokenRepository';
import { DrizzleAccessRequestRepository } from '../../src/infrastructure/db/repositories/DrizzleAccessRequestRepository';
import { createLogger } from '../../src/infrastructure/logger';
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
  createSpreadsheetConfig,
  createOAuthToken,
} from './helpers/fixtures';

describe.skipIf(!isDockerAvailable())('Account deletion database barrier', () => {
  let container: StartedPostgreSqlContainer;
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repo: DrizzleAccountDeletionRepository;

  beforeAll(async () => {
    container = await startDbContainer();
    sql = postgres(getConnectionString(container), { max: 2 });
    await runMigrations(sql);
    db = drizzle(sql, { schema });
    repo = new DrizzleAccountDeletionRepository(db);
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end();
    if (container) await stopDbContainer(container);
  });

  it('persists an identity barrier and deletes expenses before their configuration', async () => {
    const owner = await createUser(db);
    const other = await createUser(db);
    await createMessagingIdentity(db, { userId: owner.userId, externalId: 'delete-owner' });
    await createMessagingIdentity(db, { userId: other.userId, externalId: 'keep-other' });
    await createOAuthToken(db, { userId: owner.userId });
    const config = await createSpreadsheetConfig(db, { userId: owner.userId });
    await db.insert(schema.expenseRecords).values({
      userId: owner.userId,
      spreadsheetId: config.id,
      concepto: 'Test expense',
      monto: '12.00',
      moneda: 'EUR',
      fechaGasto: '2026-11-17',
      sheetName: 'Gastos',
      rawMessage: 'Test expense 12',
    });

    expect(await repo.begin(owner.userId)).toBe(true);
    expect(await repo.begin(owner.userId)).toBe(true);
    expect(await repo.isDeleting(owner.userId)).toBe(true);
    expect(await repo.isIdentityDeleting('telegram', 'delete-owner')).toBe(true);
    expect(await repo.isIdentityDeleting('telegram', 'keep-other')).toBe(false);
    await repo.eraseAccount(owner.userId);
    await repo.eraseAccount(owner.userId);
    expect(
      await db
        .select()
        .from(schema.expenseRecords)
        .where(eq(schema.expenseRecords.userId, owner.userId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.spreadsheetConfigs)
        .where(eq(schema.spreadsheetConfigs.userId, owner.userId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.userId, owner.userId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.users).where(eq(schema.users.userId, other.userId)),
    ).toHaveLength(1);
    expect(await repo.isDeleting(owner.userId)).toBe(true);
  });

  it('atomically consumes only an unexpired confirmation from its own identity', async () => {
    const owner = await createUser(db);
    const other = await createUser(db);
    await createMessagingIdentity(db, { userId: owner.userId, externalId: 'confirm-owner' });
    await createMessagingIdentity(db, { userId: other.userId, externalId: 'confirm-other' });
    await db.insert(schema.conversationStates).values({
      userId: owner.userId,
      currentState: 'SETTINGS_MENU',
      revision: 7n,
      statePayload: { screen: 'account_deletion' },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const confirmation = {
      userId: owner.userId,
      channel: 'telegram',
      externalId: 'confirm-owner',
      revision: '7',
    };
    expect(await repo.confirm({ ...confirmation, externalId: 'confirm-other' })).toBe(false);
    expect(await repo.isDeleting(owner.userId)).toBe(false);
    expect(await repo.confirm(confirmation)).toBe(true);
    expect(await repo.confirm(confirmation)).toBe(false);
    expect(await repo.isDeleting(owner.userId)).toBe(true);
    const [state] = await db
      .select()
      .from(schema.conversationStates)
      .where(eq(schema.conversationStates.userId, owner.userId));
    expect(state).toMatchObject({ currentState: 'IDLE', statePayload: null, revision: 8n });
  });

  it('rejects an expired confirmation without opening the barrier', async () => {
    const owner = await createUser(db);
    await createMessagingIdentity(db, { userId: owner.userId, externalId: 'expired-owner' });
    await db.insert(schema.conversationStates).values({
      userId: owner.userId,
      currentState: 'SETTINGS_MENU',
      revision: 1n,
      statePayload: { screen: 'account_deletion' },
      expiresAt: new Date(Date.now() - 1_000),
    });
    expect(
      await repo.confirm({
        userId: owner.userId,
        channel: 'telegram',
        externalId: 'expired-owner',
        revision: '1',
      }),
    ).toBe(false);
    expect(await repo.isDeleting(owner.userId)).toBe(false);
  });

  it('blocks stale active and candidate credential writes after the barrier', async () => {
    const owner = await createUser(db);
    const [request] = await db
      .insert(schema.accessRequests)
      .values({
        userId: owner.userId,
        email: 'credential-owner@example.test',
        kind: 'replacement',
        status: 'pending',
      })
      .returning();
    if (!request) throw new Error('Missing request fixture');
    expect(await repo.begin(owner.userId)).toBe(true);
    const encrypted = Buffer.from('encrypted-test-value');
    await expect(
      new DrizzleOAuthTokenRepository(db).upsert({
        userId: owner.userId,
        provider: 'google',
        accessTokenEnc: encrypted,
        refreshTokenEnc: encrypted,
        iv: encrypted,
        refreshIv: encrypted,
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
        scope: [],
        grantedAt: new Date(),
        lastRefreshedAt: null,
        revokedAt: null,
      }),
    ).rejects.toThrow('ACCOUNT_CREDENTIAL_WRITE_BLOCKED');
    await expect(
      new DrizzleCandidateOAuthTokenRepository(db).upsert({
        requestId: request.id,
        userId: owner.userId,
        accessTokenEnc: encrypted,
        refreshTokenEnc: encrypted,
        iv: encrypted,
        refreshIv: encrypted,
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
        scope: [],
        grantedAt: new Date(),
        lastRefreshedAt: null,
        revokedAt: null,
      }),
    ).rejects.toThrow('ACCOUNT_CREDENTIAL_WRITE_BLOCKED');
    expect(
      await db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.userId, owner.userId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.candidateOAuthTokens)
        .where(eq(schema.candidateOAuthTokens.userId, owner.userId)),
    ).toHaveLength(0);
  });

  it('blocks a new access request after the barrier', async () => {
    const owner = await createUser(db);
    expect(await repo.begin(owner.userId)).toBe(true);
    const requests = new DrizzleAccessRequestRepository(db, createLogger({ level: 'silent' }));
    await expect(
      requests.submit(owner.userId, 'late-request@example.test', 'initial'),
    ).rejects.toThrow('ACCOUNT_ACCESS_REQUEST_BLOCKED');
    expect(
      await db
        .select()
        .from(schema.accessRequests)
        .where(eq(schema.accessRequests.userId, owner.userId)),
    ).toHaveLength(0);
  });

  it('waits for a prior identity-cache fill before opening the deletion barrier', async () => {
    const owner = await createUser(db);
    await createMessagingIdentity(db, { userId: owner.userId, externalId: 'cache-race-owner' });
    const cache = new Map<string, string>();
    let releaseCacheWrite: (() => void) | undefined;
    let reportWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      reportWriteStarted = resolve;
    });
    const waitForRelease = new Promise<void>((resolve) => {
      releaseCacheWrite = resolve;
    });
    const redis = {
      get: vi.fn((key: string) => Promise.resolve(cache.get(key) ?? null)),
      setex: vi.fn(async (key: string, _ttl: number, value: string) => {
        reportWriteStarted?.();
        await waitForRelease;
        cache.set(key, value);
        return 'OK';
      }),
      del: vi.fn((key: string) => Promise.resolve(cache.delete(key) ? 1 : 0)),
    } as unknown as Redis;
    const users = new DrizzleUserRepository(db, redis);
    const lookup = users.findByMessagingIdentity('telegram', 'cache-race-owner');
    await writeStarted;
    let barrierSettled = false;
    const begin = repo.begin(owner.userId).then((result) => {
      barrierSettled = true;
      return result;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(barrierSettled).toBe(false);
    } finally {
      releaseCacheWrite?.();
    }
    expect((await lookup)?.userId).toBe(owner.userId);
    expect(await begin).toBe(true);
    expect(await users.findByMessagingIdentity('telegram', 'cache-race-owner')).toBeNull();
    await redis.del('identity:telegram:cache-race-owner');
    expect(await users.findByMessagingIdentity('telegram', 'cache-race-owner')).toBeNull();
    expect(redis.setex).toHaveBeenCalledTimes(1);
  });

  it('serializes queued message admission with the deletion barrier', async () => {
    const owner = await createUser(db);
    await createMessagingIdentity(db, { userId: owner.userId, externalId: 'admission-owner' });
    const enqueueStarted = vi.fn();
    let releaseEnqueue: (() => void) | undefined;
    const enqueueHold = new Promise<void>((resolve) => {
      releaseEnqueue = resolve;
    });
    let reportStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const admitted = repo.admitIdentityDelivery('telegram', 'admission-owner', async () => {
      enqueueStarted();
      reportStarted?.();
      await enqueueHold;
    });
    await started;
    let barrierSettled = false;
    const begin = repo.begin(owner.userId).then((result) => {
      barrierSettled = true;
      return result;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(barrierSettled).toBe(false);
    } finally {
      releaseEnqueue?.();
    }
    expect(await admitted).toBe('admitted');
    expect(await begin).toBe(true);
    expect(
      await repo.admitIdentityDelivery('telegram', 'admission-owner', async () => {
        enqueueStarted();
      }),
    ).toBe('deleting');
    expect(enqueueStarted).toHaveBeenCalledTimes(1);
    expect(
      await repo.admitIdentityDelivery('telegram', 'unknown', async () => {
        enqueueStarted();
      }),
    ).toBe('unknown');
  });
});
