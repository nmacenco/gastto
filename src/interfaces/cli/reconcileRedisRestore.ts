import { Queue } from 'bullmq';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { env } from '../../config/env';
import * as schema from '../../infrastructure/db/schema';
import { RedisRestoreGuard } from '../../infrastructure/redis/RedisRestoreGuard';
import {
  RedisRestoreReconciler,
  RedisRestoreReconciliationError,
} from '../../infrastructure/redis/RedisRestoreReconciler';

/** Offline operator command. The flags attest that every app process is stopped. */
export async function reconcileRedisRestoreCli(args: string[]): Promise<number> {
  if (args.length !== 2 || !args.includes('--apply') || !args.includes('--quarantined')) {
    process.stderr.write('Usage: redis:restore:reconcile --apply --quarantined\n');
    return 2;
  }
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
    const db = drizzle(sql, { schema });
    const guard = new RedisRestoreGuard(db, redis);
    const reconciler = new RedisRestoreReconciler(db, redis, queues, guard);
    process.stdout.write(`${JSON.stringify(await reconciler.reconcile())}\n`);
    return 0;
  } catch (error) {
    const code =
      error instanceof RedisRestoreReconciliationError
        ? error.code
        : 'REDIS_RESTORE_RECONCILIATION_FAILED';
    process.stderr.write(`${code}; keep ingress and workers quarantined.\n`);
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
  void reconcileRedisRestoreCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
