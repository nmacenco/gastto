import { Queue } from 'bullmq';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { env } from '../../config/env';
import * as schema from '../../infrastructure/db/schema';
import { RedisRestoreInventory } from '../../infrastructure/redis/RedisRestoreInventory';

/** Read-only counts for an isolated Aiven restore; does not authorize resuming workers. */
export async function inspectRedisRestoreCli(): Promise<number> {
  const sql = postgres(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queues = [
    'incoming-message',
    'process-message',
    'oauth-reminder',
    'account-deletion',
    'session-timeout',
  ].map((name) => ({ name, queue: new Queue(name, { connection: redis }) }));
  try {
    const inventory = new RedisRestoreInventory(drizzle(sql, { schema }), redis, queues);
    process.stdout.write(`${JSON.stringify(await inventory.inspect())}\n`);
    return 0;
  } catch {
    process.stderr.write('Redis restore inventory failed; keep ingress and workers quarantined.\n');
    return 1;
  } finally {
    await Promise.allSettled([
      ...queues.map(({ queue }) => queue.close()),
      redis.quit(),
      sql.end(),
    ]);
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  void inspectRedisRestoreCli().then((code) => {
    process.exitCode = code;
  });
}
