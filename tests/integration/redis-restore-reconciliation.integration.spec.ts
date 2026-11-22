import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import postgres from 'postgres';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as schema from '../../src/infrastructure/db/schema';
import { RedisRestoreGuard } from '../../src/infrastructure/redis/RedisRestoreGuard';
import { RedisRestoreReconciler } from '../../src/infrastructure/redis/RedisRestoreReconciler';
import {
  startDbContainer,
  stopDbContainer,
  getConnectionString,
  isDockerAvailable,
} from './helpers/db-container';
import { runMigrations } from './helpers/migrate';
import { createUser, createMessagingIdentity } from './helpers/fixtures';

describe.skipIf(!isDockerAvailable())('Redis restore reconciliation', () => {
  let pg: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  let sql: postgres.Sql;
  let redis: Redis;
  let queues: Array<{ name: string; queue: Queue }>;
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
    queues = [
      'incoming-message',
      'process-message',
      'oauth-reminder',
      'account-deletion',
      'session-timeout',
    ].map((name) => ({ name, queue: new Queue(name, { connection: redis }) }));
  }, 120_000);

  afterAll(async () => {
    await Promise.all(queues?.map(({ queue }) => queue.close()) ?? []);
    redis?.disconnect();
    if (sql) await sql.end();
    await Promise.all([pg && stopDbContainer(pg), redisContainer?.stop()]);
  });

  it('refuses unknown work, then removes only proven orphans and restores the guard', async () => {
    const owner = await createUser(db);
    await createMessagingIdentity(db, { userId: owner.userId, externalId: 'restore-live-chat' });
    await db
      .insert(schema.conversationStates)
      .values({ userId: owner.userId, currentState: 'IDLE' });
    const orphanId = '00000000-0000-4000-8000-000000000456';
    const guard = new RedisRestoreGuard(db, redis);
    await guard.assertCurrent();
    await guard.recordCleanup();
    const [epoch] = await db.select().from(schema.redisRecoveryEpoch);
    if (!epoch) throw new Error('Missing recovery epoch');
    await redis.set('gastto:redis-recovery-epoch', String(epoch.epoch - 1));
    await db
      .update(schema.redisRecoveryEpoch)
      .set({ runId: 'previous-valkey-run' })
      .where(eq(schema.redisRecoveryEpoch.id, 1));
    await expect(guard.assertCurrent()).rejects.toThrow('REDIS_RESTORE_QUARANTINE');

    const incoming = queues.find(({ name }) => name === 'incoming-message')!.queue;
    const reminders = queues.find(({ name }) => name === 'oauth-reminder')!.queue;
    const payload = {
      messageType: 'TEXT',
      channel: 'telegram',
      timestamp: new Date().toISOString(),
      externalMessageId: 'restore-message',
    };
    const unresolved = await incoming.add('current', {
      ...payload,
      userId: owner.userId,
      chatId: 'restore-live-chat',
    });
    const orphan = await incoming.add('orphan', {
      ...payload,
      userId: orphanId,
      chatId: 'restore-orphan-chat',
    });
    const obsolete = await reminders.add(
      'oauth-reminder',
      { userId: owner.userId, channel: 'telegram', externalId: 'restore-live-chat' },
      { delay: 60_000 },
    );
    await redis.set('identity:telegram:restore-live-chat', owner.userId);
    await redis.set('identity:telegram:restore-orphan-chat', orphanId);
    await redis.set(`conversation:${orphanId}:mapping-correction`, '{}');
    await redis.sadd(`processed_message:owner:${orphanId}`, 'processed_message:telegram:restored');
    await redis.set('processed_message:telegram:restored', '1');
    await redis.set('oauth:state:restored', JSON.stringify({ userId: orphanId }));
    await redis.set(`process-message:lock:${orphanId}`, 'old-lock');

    const reconciler = new RedisRestoreReconciler(db, redis, queues, guard);
    await expect(reconciler.reconcile()).rejects.toMatchObject({
      code: 'REDIS_RESTORE_REVIEW_REQUIRED',
    });
    expect(await redis.get('gastto:redis-recovery-epoch')).toBe(String(epoch.epoch - 1));
    expect(await orphan.getState()).toBe('waiting');

    await unresolved.remove();
    await redis.set('unexpected:restored', '1');
    await expect(reconciler.reconcile()).rejects.toMatchObject({
      code: 'REDIS_RESTORE_UNKNOWN_KEY_FAMILY',
    });
    await redis.del('unexpected:restored');

    await redis.sadd(
      `processed_message:owner:${owner.userId}`,
      'processed_message:telegram:restored',
    );
    await expect(reconciler.reconcile()).rejects.toMatchObject({
      code: 'REDIS_RESTORE_UNKNOWN_MARKER',
    });
    expect(await orphan.getState()).toBe('waiting');
    await redis.del(`processed_message:owner:${owner.userId}`);

    await redis.setex('processed_message:telegram:unowned', 60, '1');
    await expect(reconciler.reconcile()).rejects.toMatchObject({
      code: 'REDIS_RESTORE_REVIEW_REQUIRED',
    });
    await redis.del('processed_message:telegram:unowned');
    await db
      .update(schema.users)
      .set({ activeExternalWorkCount: 1 })
      .where(eq(schema.users.userId, owner.userId));
    await expect(reconciler.reconcile()).rejects.toMatchObject({
      code: 'REDIS_RESTORE_EXTERNAL_WORK_ACTIVE',
    });
    await db
      .update(schema.users)
      .set({ activeExternalWorkCount: 0 })
      .where(eq(schema.users.userId, owner.userId));

    const result = await reconciler.reconcile();
    expect(result).toMatchObject({ removedJobs: 2, epoch: epoch.epoch });
    expect(result.removedKeys).toBeGreaterThanOrEqual(6);
    await expect(guard.assertCurrent()).resolves.toBeUndefined();
    expect(await incoming.getJob(orphan.id!)).toBeUndefined();
    expect(await reminders.getJob(obsolete.id!)).toBeUndefined();
    expect(await redis.get('identity:telegram:restore-live-chat')).toBe(owner.userId);
    expect(await redis.get('identity:telegram:restore-orphan-chat')).toBeNull();
    expect(await redis.get(`processed_message:owner:${orphanId}`)).toBeNull();
    expect(await redis.get('oauth:state:restored')).toBeNull();
  });
});
