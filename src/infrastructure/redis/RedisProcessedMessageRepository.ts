// LAYER: Infrastructure
// Redis-backed adapter for idempotent message tracking.
// Stores a lightweight marker per external message ID with a fixed TTL
// so Telegram retries are deduplicated without unbounded Redis growth.

import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import type { IProcessedMessageRepository } from '../../domain/ports/ProcessedMessageRepository';
import type { ProcessedMessageKey } from '../../domain/value-objects/ProcessedMessageKey';

const PROCESSED_MESSAGE_TTL_SECONDS = 86_400; // 24 hours

export class RedisProcessedMessageRepository implements IProcessedMessageRepository {
  constructor(private readonly redis: Redis) {}

  private key(value: ProcessedMessageKey): string {
    if (value.externalIdentityId) {
      const identityHash = createHash('sha256').update(value.externalIdentityId).digest('hex');
      return `processed_message:${value.channel}:${identityHash}:${value.externalMessageId}`;
    }
    return `processed_message:${value.channel}:${value.externalMessageId}`;
  }

  async exists(key: ProcessedMessageKey): Promise<boolean> {
    const result = await this.redis.exists(this.key(key));
    return result === 1;
  }

  async markAsProcessed(key: ProcessedMessageKey, userId?: string): Promise<void> {
    const marker = this.key(key);
    if (userId) {
      const ownerKey = `processed_message:owner:${userId}`;
      const result = await this.redis
        .multi()
        .setex(marker, PROCESSED_MESSAGE_TTL_SECONDS, '1')
        .sadd(ownerKey, marker)
        .expire(ownerKey, PROCESSED_MESSAGE_TTL_SECONDS)
        .exec();
      if (!result || result.some(([error]) => error !== null)) {
        throw new Error('PROCESSED_MESSAGE_MARK_FAILED');
      }
      return;
    }
    await this.redis.setex(marker, PROCESSED_MESSAGE_TTL_SECONDS, '1');
  }
}
