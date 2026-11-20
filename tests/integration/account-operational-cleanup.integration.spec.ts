import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import Redis from 'ioredis';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { AccountOperationalCleanup } from '../../src/infrastructure/redis/AccountOperationalCleanup';

describe('Account operational cleanup with Redis and BullMQ', () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let incoming: Queue;
  let processing: Queue;
  let reminders: Queue;

  beforeAll(async () => {
    container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    redis = new Redis(container.getMappedPort(6379), container.getHost());
    await redis.ping();
    incoming = new Queue('deletion-test-incoming', { connection: redis });
    processing = new Queue('deletion-test-processing', { connection: redis });
    reminders = new Queue('deletion-test-reminders', { connection: redis });
  }, 120_000);

  afterAll(async () => {
    await Promise.all([incoming?.close(), processing?.close(), reminders?.close()]);
    redis?.disconnect();
    await container?.stop();
  });

  it('removes only the owner jobs and Redis keys across queue states', async () => {
    const mineIncoming = await incoming.add('message', {
      channel: 'telegram',
      chatId: 'owner',
      rawPayload: { text: 'private' },
    });
    const otherIncoming = await incoming.add('message', { channel: 'telegram', chatId: 'other' });
    const mineProcess = await processing.add(
      'process',
      { userId: 'owner-id', rawMessage: 'private' },
      { delay: 60_000 },
    );
    const otherProcess = await processing.add('process', { userId: 'other-id' });
    const mineReminder = await reminders.add('reminder', { userId: 'owner-id' });
    await redis.set('identity:telegram:owner', 'owner-id');
    await redis.set('identity:telegram:other', 'other-id');
    await redis.set('conversation:owner-id:mapping-correction', 'private');
    await redis.set('oauth:state:mine', JSON.stringify({ userId: 'owner-id' }));
    await redis.set('oauth:state:other', JSON.stringify({ userId: 'other-id' }));
    await redis.set('processed_message:telegram:owned-msg', '1');
    await redis.sadd('processed_message:owner:owner-id', 'processed_message:telegram:owned-msg');
    await redis.set('processed_message:telegram:other-msg', '1');

    const cleanup = new AccountOperationalCleanup(redis, incoming, processing, reminders);
    await cleanup.clean('owner-id', [{ channel: 'telegram', externalId: 'owner' }]);
    await cleanup.clean('owner-id', [{ channel: 'telegram', externalId: 'owner' }]);

    expect(await incoming.getJob(mineIncoming.id!)).toBeUndefined();
    expect(await processing.getJob(mineProcess.id!)).toBeUndefined();
    expect(await reminders.getJob(mineReminder.id!)).toBeUndefined();
    expect(await incoming.getJob(otherIncoming.id!)).toBeDefined();
    expect(await processing.getJob(otherProcess.id!)).toBeDefined();
    expect(await redis.get('identity:telegram:owner')).toBeNull();
    expect(await redis.get('conversation:owner-id:mapping-correction')).toBeNull();
    expect(await redis.get('oauth:state:mine')).toBeNull();
    expect(await redis.get('oauth:state:other')).not.toBeNull();
    expect(await redis.get('processed_message:telegram:owned-msg')).toBeNull();
    expect(await redis.get('processed_message:telegram:other-msg')).not.toBeNull();
  });

  it('refuses completion while an owned processing job is active', async () => {
    const activeQueue = new Queue('deletion-test-active', { connection: redis });
    const workerRedis = new Redis(container.getMappedPort(6379), container.getHost(), {
      maxRetriesPerRequest: null,
    });
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const worker = new Worker(
      'deletion-test-active',
      async () => {
        entered();
        await blocked;
      },
      { connection: workerRedis },
    );
    try {
      await activeQueue.add('message', { userId: 'owner-active' });
      await started;
      const cleanup = new AccountOperationalCleanup(redis, incoming, activeQueue, reminders);
      await expect(cleanup.clean('owner-active', [])).rejects.toThrow('ACCOUNT_JOB_STILL_ACTIVE');
      release();
      await worker.close();
      await cleanup.clean('owner-active', []);
      expect(await activeQueue.getJobCounts('completed', 'waiting', 'active')).toMatchObject({
        completed: 0,
        waiting: 0,
        active: 0,
      });
    } finally {
      release();
      await worker.close();
      workerRedis.disconnect();
      await activeQueue.close();
    }
  });

  it('removes retained prioritized, paused, completed, and failed payloads without touching another account', async () => {
    const stateQueue = new Queue('deletion-test-retained-states', { connection: redis });
    const eventsRedis = new Redis(container.getMappedPort(6379), container.getHost(), {
      maxRetriesPerRequest: null,
    });
    const workerRedis = new Redis(container.getMappedPort(6379), container.getHost(), {
      maxRetriesPerRequest: null,
    });
    const events = new QueueEvents('deletion-test-retained-states', { connection: eventsRedis });
    const worker = new Worker(
      'deletion-test-retained-states',
      async (job) => {
        if (job.data.fail) throw new Error('test failure');
      },
      { connection: workerRedis },
    );
    try {
      await events.waitUntilReady();
      const completed = await stateQueue.add('completed', { userId: 'owner-id', text: 'private' });
      await completed.waitUntilFinished(events);
      const failed = await stateQueue.add('failed', { userId: 'owner-id', fail: true, text: 'private' });
      await expect(failed.waitUntilFinished(events)).rejects.toThrow('test failure');

      await worker.close();
      const prioritized = await stateQueue.add(
        'prioritized',
        { userId: 'owner-id', text: 'private' },
        { priority: 1 },
      );
      await stateQueue.pause();
      const paused = await stateQueue.add('paused', { userId: 'owner-id', text: 'private' });
      const other = await stateQueue.add('other', { userId: 'other-id', text: 'keep' });

      const cleanup = new AccountOperationalCleanup(redis, incoming, stateQueue, reminders);
      await cleanup.clean('owner-id', []);

      for (const job of [completed, failed, prioritized, paused]) {
        expect(await stateQueue.getJob(job.id!)).toBeUndefined();
      }
      expect(await stateQueue.getJob(other.id!)).toBeDefined();
    } finally {
      await worker.close();
      await events.close();
      await stateQueue.close();
      eventsRedis.disconnect();
      workerRedis.disconnect();
    }
  });
});
