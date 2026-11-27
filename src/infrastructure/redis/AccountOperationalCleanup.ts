// LAYER: Infrastructure
// Targeted cleanup of retained queue payloads and account-owned Redis keys.
import type { Queue, Job } from 'bullmq';
import type { Redis } from 'ioredis';

export interface DeletionIdentity {
  channel: string;
  externalId: string;
}

type JobData = Record<string, unknown>;
const retainedJobStates = [
  'waiting',
  'prioritized',
  'delayed',
  'paused',
  'completed',
  'failed',
  'waiting-children',
  'active',
] as const;

export class AccountOperationalCleanup {
  constructor(
    private readonly redis: Redis,
    private readonly incoming: Queue,
    private readonly processing: Queue,
    private readonly reminders: Queue,
  ) {}

  async clean(userId: string, identities: readonly DeletionIdentity[]): Promise<void> {
    await this.removeOwnedJobs(
      this.incoming,
      (data) =>
        data.userId === userId ||
        identities.some(
          (identity) => data.channel === identity.channel && data.chatId === identity.externalId,
        ),
    );
    await this.removeOwnedJobs(this.processing, (data) => data.userId === userId);
    await this.removeOwnedJobs(this.reminders, (data) => data.userId === userId);

    for (const identity of identities) {
      await this.redis.del(`identity:${identity.channel}:${identity.externalId}`);
    }
    await this.redis.del(`conversation:${userId}:mapping-correction`);
    const ownerMarkers = `processed_message:owner:${userId}`;
    const markers = await this.redis.smembers(ownerMarkers);
    if (markers.length) await this.redis.del(...markers);
    await this.redis.del(ownerMarkers);
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', 'oauth:state:*', 'COUNT', 100);
      cursor = next;
      for (const key of keys) {
        const value = await this.redis.get(key);
        if (!value) continue;
        try {
          const parsed: unknown = JSON.parse(value);
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            'userId' in parsed &&
            parsed.userId === userId
          ) {
            await this.redis.del(key);
          }
        } catch {
          // Unknown owner: do not delete another account's data.
        }
      }
    } while (cursor !== '0');
  }

  private async removeOwnedJobs(
    queue: Queue,
    belongsToUser: (data: JobData) => boolean,
  ): Promise<void> {
    const jobs = await queue.getJobs([...retainedJobStates], 0, -1);
    for (const job of jobs) {
      if (!this.matches(job, belongsToUser)) continue;
      if ((await job.getState()) === 'active') throw new Error('ACCOUNT_JOB_STILL_ACTIVE');
      await job.remove();
    }
    // A job can change state while getJobs enumerates its Redis lists. Recheck
    // before erasure; an ambiguous scan must retain the deletion barrier.
    const remaining = await queue.getJobs([...retainedJobStates], 0, -1);
    for (const job of remaining) {
      if (!this.matches(job, belongsToUser)) continue;
      if ((await job.getState()) === 'active') throw new Error('ACCOUNT_JOB_STILL_ACTIVE');
      throw new Error('ACCOUNT_JOB_CLEANUP_INCOMPLETE');
    }
  }

  private matches(job: Job, belongsToUser: (data: JobData) => boolean): boolean {
    const data: unknown = job.data;
    return typeof data === 'object' && data !== null && belongsToUser(data as JobData);
  }
}
