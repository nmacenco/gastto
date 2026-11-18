import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { Queue } from 'bullmq';
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
import { AccountOperationalCleanup } from '../../src/infrastructure/redis/AccountOperationalCleanup';
import { RedisUserProcessingLock } from '../../src/infrastructure/redis/RedisUserProcessingLock';
import { RevokeAccountCredentials } from '../../src/application/use-cases/user/RevokeAccountCredentials';
import { AccountDeletionService } from '../../src/application/services/AccountDeletionService';
import type { TokenEncryptionPort } from '../../src/domain/ports/tokenEncryption';

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
    await db.insert(schema.expenseRecords).values({
      userId: owner.userId,
      spreadsheetId: config.id,
      concepto: 'Expense',
      monto: '9.00',
      moneda: 'EUR',
      fechaGasto: '2026-11-17',
      sheetName: 'Gastos',
      rawMessage: 'Expense 9',
    });
    const ownedIncoming = await incoming.add('message', {
      channel: 'telegram',
      chatId: 'delete-chat',
      rawPayload: { text: 'Expense 9' },
    });
    const ownedProcessing = await processing.add('message', {
      userId: owner.userId,
      rawMessage: 'Expense 9',
    });
    const otherProcessing = await processing.add('message', { userId: other.userId });
    await redis.set('identity:telegram:delete-chat', owner.userId);
    await redis.set(
      'oauth:state:delete',
      JSON.stringify({ userId: owner.userId, externalId: 'delete-chat' }),
    );
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
    );
    await service.resume(owner.userId);
    await service.resume(owner.userId);
    expect(revokeToken).toHaveBeenCalledTimes(2);
    expect(revokeToken).toHaveBeenCalledWith('google', 'refresh-token');
    expect(sendMessage).toHaveBeenCalledWith(
      'delete-chat',
      expect.stringContaining('no pudo confirmar la revocación'),
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
    expect(await processing.getJob(otherProcessing.id!)).toBeDefined();
    expect(await redis.get('identity:telegram:delete-chat')).toBeNull();
    expect(await redis.get('oauth:state:delete')).toBeNull();
    expect(await repo.get(owner.userId)).toBeNull();
  });
});
