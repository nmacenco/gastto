// LAYER: Infrastructure
// Read-only inventory for a quarantined Redis restore. Never prints payloads or identifiers.
import type { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Redis } from 'ioredis';
import * as schema from '../db/schema';
import { classifyRestoredJob, type RestoredJobDecision } from './RestoredJobPolicy';

export const retainedStates = [
  'waiting',
  'prioritized',
  'delayed',
  'paused',
  'completed',
  'failed',
  'waiting-children',
  'active',
] as const;

type Classification = 'current' | 'orphan' | 'uncertain';
type Counts = Record<Classification, number>;

export interface RedisRestoreInventoryReport {
  jobs: Counts & { active: number; global: number };
  jobDecisions: Record<string, Record<RestoredJobDecision, number>>;
  identityCaches: Counts;
  correctionStates: Counts;
  processedOwnerIndexes: Counts;
  processedMarkersWithoutOwner: number;
  oauthStates: Counts;
  safeToResume: false;
}

function counts(): Counts {
  return { current: 0, orphan: 0, uncertain: 0 };
}

function decisionCounts(): Record<RestoredJobDecision, number> {
  return {
    orphaned: 0,
    pendingDeletion: 0,
    completedHistory: 0,
    failedHistory: 0,
    obsoleteReminder: 0,
    unresolved: 0,
    global: 0,
    invalidPayload: 0,
  };
}

/** Every restored account job is uncertain until its post-backup effect is reconciled. */
export class RedisRestoreInventory {
  constructor(
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redis: Pick<Redis, 'scan' | 'get' | 'smembers'>,
    private readonly queues: ReadonlyArray<{ name: string; queue: Pick<Queue, 'getJobs'> }>,
  ) {}

  async inspect(): Promise<RedisRestoreInventoryReport> {
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
    const liveUsers = new Set(users.map((row) => row.userId));
    const deletingUsers = new Set(deleting.map((row) => row.userId));
    const ownerByIdentity = new Map(
      identities.map((row) => [`identity:${row.channel}:${row.externalId}`, row.userId]),
    );
    const conversationByUser = new Map(conversations.map((row) => [row.userId, row]));
    const classifyUser = (userId: string): Classification =>
      liveUsers.has(userId) && !deletingUsers.has(userId) ? 'current' : 'orphan';
    const report: RedisRestoreInventoryReport = {
      jobs: { ...counts(), active: 0, global: 0 },
      jobDecisions: {},
      identityCaches: counts(),
      correctionStates: counts(),
      processedOwnerIndexes: counts(),
      processedMarkersWithoutOwner: 0,
      oauthStates: counts(),
      safeToResume: false,
    };

    for (const { name, queue } of this.queues) {
      const decisions = decisionCounts();
      report.jobDecisions[name] = decisions;
      const jobs = await queue.getJobs([...retainedStates], 0, -1);
      for (const job of jobs) {
        const state = await job.getState();
        if (state === 'active') report.jobs.active++;
        const decision = classifyRestoredJob(name, job.data, state, {
          liveUsers,
          deletingUsers,
          ownerByIdentity,
          conversationByUser,
        });
        decisions[decision]++;
        if (decision === 'orphaned') report.jobs.orphan++;
        else if (decision === 'completedHistory' || decision === 'obsoleteReminder')
          report.jobs.current++;
        else if (decision === 'global') report.jobs.global++;
        else report.jobs.uncertain++;
      }
    }

    const linkedMarkers = new Set<string>();
    for (const key of await this.scan('processed_message:owner:*')) {
      const userId = key.slice('processed_message:owner:'.length);
      if (!userId) {
        report.processedOwnerIndexes.uncertain++;
        continue;
      }
      report.processedOwnerIndexes[classifyUser(userId)]++;
      for (const marker of await this.redis.smembers(key)) linkedMarkers.add(marker);
    }
    for (const key of await this.scan('processed_message:*')) {
      if (key.startsWith('processed_message:owner:')) continue;
      if (!linkedMarkers.has(key)) report.processedMarkersWithoutOwner++;
    }
    for (const key of await this.scan('identity:*')) {
      const owner = await this.redis.get(key);
      const expected = ownerByIdentity.get(key);
      report.identityCaches[
        !owner
          ? 'uncertain'
          : owner === expected && !deletingUsers.has(owner)
            ? 'current'
            : 'orphan'
      ]++;
    }
    for (const key of await this.scan('conversation:*:mapping-correction')) {
      const userId = key.slice('conversation:'.length, -':mapping-correction'.length);
      report.correctionStates[userId ? classifyUser(userId) : 'uncertain']++;
    }
    for (const key of await this.scan('oauth:state:*')) {
      const value = await this.redis.get(key);
      try {
        const parsed: unknown = JSON.parse(value ?? 'null');
        const owner =
          typeof parsed === 'object' && parsed !== null && 'userId' in parsed
            ? parsed.userId
            : null;
        report.oauthStates[typeof owner === 'string' ? classifyUser(owner) : 'uncertain']++;
      } catch {
        report.oauthStates.uncertain++;
      }
    }
    return report;
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
}
