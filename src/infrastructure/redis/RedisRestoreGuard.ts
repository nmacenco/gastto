import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Redis } from 'ioredis';
import * as schema from '../db/schema';

const MARKER_KEY = 'gastto:redis-recovery-epoch';
const ADVANCE_MARKER = `
local current = tonumber(redis.call('GET', KEYS[1]) or '-1')
local next = tonumber(ARGV[1])
if not next then return redis.error_reply('INVALID_RECOVERY_EPOCH') end
if current < next then redis.call('SET', KEYS[1], ARGV[1]) end
return 1
`;

export class RedisRestoreQuarantineError extends Error {
  constructor() {
    super('REDIS_RESTORE_QUARANTINE');
    this.name = 'RedisRestoreQuarantineError';
  }
}

/** Detects snapshots older than the latest completed account cleanup. */
export class RedisRestoreGuard {
  constructor(
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redis: Pick<Redis, 'get' | 'set' | 'setnx' | 'info' | 'eval'>,
  ) {}

  private async currentRunId(): Promise<string> {
    const info = await this.redis.info('server');
    const runId = /^run_id:([^\r\n]+)$/m.exec(info)?.[1];
    if (!runId) throw new RedisRestoreQuarantineError();
    return runId;
  }

  async assertCurrent(): Promise<void> {
    const runId = await this.currentRunId();
    let [row] = await this.db
      .select({ epoch: schema.redisRecoveryEpoch.epoch, runId: schema.redisRecoveryEpoch.runId })
      .from(schema.redisRecoveryEpoch)
      .limit(1);
    if (!row) {
      await this.db
        .insert(schema.redisRecoveryEpoch)
        .values({ id: 1, epoch: 0, runId })
        .onConflictDoNothing();
      [row] = await this.db
        .select({ epoch: schema.redisRecoveryEpoch.epoch, runId: schema.redisRecoveryEpoch.runId })
        .from(schema.redisRecoveryEpoch)
        .limit(1);
    }
    if (!row || row.runId !== runId) throw new RedisRestoreQuarantineError();
    const current = row.epoch;
    let mirror = await this.redis.get(MARKER_KEY);
    if (current === 0 && mirror === null) {
      await this.redis.setnx(MARKER_KEY, '0');
      mirror = await this.redis.get(MARKER_KEY);
    }
    if (mirror !== String(current)) throw new RedisRestoreQuarantineError();
  }

  /** Called after Redis cleanup, before the deletion operation may complete. */
  async recordCleanup(): Promise<void> {
    await this.assertCurrent();
    const runId = await this.currentRunId();
    const [row] = await this.db
      .insert(schema.redisRecoveryEpoch)
      .values({ id: 1, epoch: 1, runId })
      .onConflictDoUpdate({
        target: schema.redisRecoveryEpoch.id,
        set: { epoch: sql`${schema.redisRecoveryEpoch.epoch} + 1` },
      })
      .returning({ epoch: schema.redisRecoveryEpoch.epoch });
    if (!row) throw new RedisRestoreQuarantineError();
    await this.redis.eval(ADVANCE_MARKER, 1, MARKER_KEY, String(row.epoch));
    await this.assertCurrent();
  }

  /** Use only after an offline, verified restore reconciliation. */
  async rebaseline(expected: {
    epoch: number;
    persistedRunId: string;
    restoredRunId: string;
  }): Promise<void> {
    if ((await this.currentRunId()) !== expected.restoredRunId) {
      throw new RedisRestoreQuarantineError();
    }
    const [row] = await this.db
      .select({ epoch: schema.redisRecoveryEpoch.epoch, runId: schema.redisRecoveryEpoch.runId })
      .from(schema.redisRecoveryEpoch)
      .limit(1);
    if (!row || row.epoch !== expected.epoch || row.runId !== expected.persistedRunId) {
      throw new RedisRestoreQuarantineError();
    }
    await this.redis.set(MARKER_KEY, String(expected.epoch));
    const updated = await this.db
      .update(schema.redisRecoveryEpoch)
      .set({ runId: expected.restoredRunId })
      .where(
        sql`${schema.redisRecoveryEpoch.id} = 1 AND ${schema.redisRecoveryEpoch.epoch} = ${expected.epoch} AND ${schema.redisRecoveryEpoch.runId} = ${expected.persistedRunId}`,
      )
      .returning({ id: schema.redisRecoveryEpoch.id });
    if (updated.length !== 1) throw new RedisRestoreQuarantineError();
    await this.assertCurrent();
  }
}
