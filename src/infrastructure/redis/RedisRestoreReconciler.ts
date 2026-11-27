// LAYER: Infrastructure
// Offline, fail-closed cleanup of Redis state after a provider restore.
import type { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Redis } from 'ioredis';
import * as schema from '../db/schema';
import type { RedisRestoreGuard } from './RedisRestoreGuard';
import {
  RedisRestoreInventory,
  retainedStates,
  type RedisRestoreInventoryReport,
} from './RedisRestoreInventory';
import { classifyRestoredJob } from './RestoredJobPolicy';

type RecoveryRedis = Pick<Redis, 'scan' | 'get' | 'smembers' | 'del' | 'info'>;
type RecoveryQueue = { name: string; queue: Pick<Queue, 'getJobs'> };

export class RedisRestoreReconciliationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RedisRestoreReconciliationError';
  }
}

/** Requires all application processes to be stopped. It never resolves unknown job outcomes. */
export class RedisRestoreReconciler {
  constructor(
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redis: RecoveryRedis,
    private readonly queues: readonly RecoveryQueue[],
    private readonly guard: Pick<RedisRestoreGuard, 'rebaseline' | 'assertCurrent'>,
  ) {}

  async reconcile(): Promise<{ removedJobs: number; removedKeys: number; epoch: number }> {
    const inventory = new RedisRestoreInventory(this.db, this.redis, this.queues);
    const before = await inventory.inspect();
    this.assertReviewComplete(before);
    await this.assertNoActiveExternalWork();
    await this.assertKnownKeyFamilies();
    const runId = this.readRunId(await this.redis.info('server'));
    const [row] = await this.db
      .select({ epoch: schema.redisRecoveryEpoch.epoch, runId: schema.redisRecoveryEpoch.runId })
      .from(schema.redisRecoveryEpoch)
      .limit(1);
    if (!row) throw new RedisRestoreReconciliationError('REDIS_RESTORE_EPOCH_MISSING');

    const [users, identities, deleting, conversations] = await Promise.all([
      this.db.select({ userId: schema.users.userId }).from(schema.users),
      this.db
        .select({
          userId: schema.messagingIdentities.userId,
          channel: schema.messagingIdentities.channel,
          externalId: schema.messagingIdentities.externalId,
        })
        .from(schema.messagingIdentities),
      this.db
        .select({ userId: schema.accountDeletionOperations.userId })
        .from(schema.accountDeletionOperations),
      this.db
        .select({
          userId: schema.conversationStates.userId,
          currentState: schema.conversationStates.currentState,
          statePayload: schema.conversationStates.statePayload,
          expiresAt: schema.conversationStates.expiresAt,
        })
        .from(schema.conversationStates),
    ]);
    const liveUsers = new Set(users.map((item) => item.userId));
    const deletingUsers = new Set(deleting.map((item) => item.userId));
    const ownerByIdentity = new Map(
      identities.map((item) => [`identity:${item.channel}:${item.externalId}`, item.userId]),
    );
    const conversationByUser = new Map(conversations.map((item) => [item.userId, item]));
    const ownerIndexes = await this.scan('processed_message:owner:*');
    const preservedMarkers = new Set<string>();
    for (const key of ownerIndexes) {
      const userId = key.slice('processed_message:owner:'.length);
      if (liveUsers.has(userId) && !deletingUsers.has(userId)) {
        for (const marker of await this.redis.smembers(key)) preservedMarkers.add(marker);
      }
    }
    for (const key of ownerIndexes) {
      const userId = key.slice('processed_message:owner:'.length);
      if (liveUsers.has(userId) && !deletingUsers.has(userId)) continue;
      const markers = await this.redis.smembers(key);
      if (
        markers.some(
          (marker) =>
            !marker.startsWith('processed_message:') ||
            marker.startsWith('processed_message:owner:') ||
            preservedMarkers.has(marker),
        )
      ) {
        throw new RedisRestoreReconciliationError('REDIS_RESTORE_UNKNOWN_MARKER');
      }
    }
    let removedJobs = 0;
    for (const { name, queue } of this.queues) {
      for (const job of await queue.getJobs([...retainedStates], 0, -1)) {
        const state = await job.getState();
        if (state === 'active')
          throw new RedisRestoreReconciliationError('REDIS_RESTORE_ACTIVE_JOB');
        const decision = classifyRestoredJob(name, job.data, state, {
          liveUsers,
          deletingUsers,
          ownerByIdentity,
          conversationByUser,
        });
        if (decision === 'orphaned' || decision === 'obsoleteReminder') {
          await job.remove();
          removedJobs++;
        } else if (decision === 'unresolved' || decision === 'invalidPayload') {
          throw new RedisRestoreReconciliationError('REDIS_RESTORE_REVIEW_REQUIRED');
        }
      }
    }

    let removedKeys = 0;
    for (const key of await this.scan('identity:*')) {
      const owner = await this.redis.get(key);
      if (owner !== ownerByIdentity.get(key) || (owner && deletingUsers.has(owner))) {
        removedKeys += await this.redis.del(key);
      }
    }
    for (const key of await this.scan('conversation:*:mapping-correction')) {
      const userId = key.slice('conversation:'.length, -':mapping-correction'.length);
      if (!liveUsers.has(userId) || deletingUsers.has(userId))
        removedKeys += await this.redis.del(key);
    }
    for (const key of ownerIndexes) {
      const userId = key.slice('processed_message:owner:'.length);
      if (liveUsers.has(userId) && !deletingUsers.has(userId)) continue;
      const markers = await this.redis.smembers(key);
      if (markers.length) removedKeys += await this.redis.del(...markers);
      removedKeys += await this.redis.del(key);
    }
    for (const key of await this.scan('oauth:state:*')) {
      const value = await this.redis.get(key);
      let owner: unknown;
      try {
        const parsed: unknown = JSON.parse(value ?? 'null');
        owner =
          typeof parsed === 'object' && parsed !== null && 'userId' in parsed
            ? parsed.userId
            : null;
      } catch {
        throw new RedisRestoreReconciliationError('REDIS_RESTORE_UNKNOWN_OAUTH_OWNER');
      }
      if (typeof owner !== 'string')
        throw new RedisRestoreReconciliationError('REDIS_RESTORE_UNKNOWN_OAUTH_OWNER');
      if (!liveUsers.has(owner) || deletingUsers.has(owner))
        removedKeys += await this.redis.del(key);
    }
    for (const key of await this.scan('process-message:lock:*')) {
      removedKeys += await this.redis.del(key);
    }

    const after = await inventory.inspect();
    this.assertReviewComplete(after);
    if (
      after.jobs.orphan > 0 ||
      after.identityCaches.orphan > 0 ||
      after.correctionStates.orphan > 0 ||
      after.processedOwnerIndexes.orphan > 0 ||
      after.oauthStates.orphan > 0 ||
      Object.values(after.jobDecisions).some((counts) => counts.obsoleteReminder > 0)
    ) {
      throw new RedisRestoreReconciliationError('REDIS_RESTORE_CLEANUP_INCOMPLETE');
    }
    await this.assertNoActiveExternalWork();
    await this.assertKnownKeyFamilies();
    if (this.readRunId(await this.redis.info('server')) !== runId) {
      throw new RedisRestoreReconciliationError('REDIS_RESTORE_RUN_CHANGED');
    }
    await this.guard.rebaseline({
      epoch: row.epoch,
      persistedRunId: row.runId,
      restoredRunId: runId,
    });
    await this.guard.assertCurrent();
    return { removedJobs, removedKeys, epoch: row.epoch };
  }

  private assertReviewComplete(report: RedisRestoreInventoryReport): void {
    if (
      report.jobs.active > 0 ||
      report.processedMarkersWithoutOwner > 0 ||
      report.identityCaches.uncertain > 0 ||
      report.correctionStates.uncertain > 0 ||
      report.processedOwnerIndexes.uncertain > 0 ||
      report.oauthStates.uncertain > 0 ||
      Object.values(report.jobDecisions).some(
        (counts) => counts.unresolved > 0 || counts.invalidPayload > 0,
      )
    ) {
      throw new RedisRestoreReconciliationError('REDIS_RESTORE_REVIEW_REQUIRED');
    }
  }

  private async assertNoActiveExternalWork(): Promise<void> {
    const rows = await this.db
      .select({ count: schema.users.activeExternalWorkCount })
      .from(schema.users);
    if (rows.some((row) => row.count > 0)) {
      throw new RedisRestoreReconciliationError('REDIS_RESTORE_EXTERNAL_WORK_ACTIVE');
    }
  }

  private async assertKnownKeyFamilies(): Promise<void> {
    const names = this.queues.map(({ name }) => name);
    for (const key of await this.scan('*')) {
      if (
        key === 'gastto:redis-recovery-epoch' ||
        key.startsWith('identity:') ||
        /^conversation:.+:mapping-correction$/.test(key) ||
        key.startsWith('processed_message:') ||
        key.startsWith('oauth:state:') ||
        key.startsWith('process-message:lock:') ||
        key.startsWith('security:') ||
        names.some((name) => key.startsWith(`bull:${name}:`))
      )
        continue;
      throw new RedisRestoreReconciliationError('REDIS_RESTORE_UNKNOWN_KEY_FAMILY');
    }
  }

  private async scan(pattern: string): Promise<Set<string>> {
    const keys = new Set<string>();
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      for (const key of batch) keys.add(key);
    } while (cursor !== '0');
    return keys;
  }

  private readRunId(info: string): string {
    const runId = /^run_id:([^\r\n]+)$/m.exec(info)?.[1];
    if (!runId) throw new RedisRestoreReconciliationError('REDIS_RESTORE_RUN_UNKNOWN');
    return runId;
  }
}
