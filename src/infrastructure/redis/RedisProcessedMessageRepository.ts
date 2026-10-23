// LAYER: Infrastructure
// Redis-backed adapter for idempotent message tracking.
// Stores a lightweight marker per external message ID with a fixed TTL
// so Telegram retries are deduplicated without unbounded Redis growth.

import type { Redis } from 'ioredis';
import type { IProcessedMessageRepository } from '../../domain/ports/ProcessedMessageRepository';
import type { ProcessedMessageKey } from '../../domain/value-objects/ProcessedMessageKey';

const PROCESSED_MESSAGE_TTL_SECONDS = 86_400; // 24 hours

export class RedisProcessedMessageRepository implements IProcessedMessageRepository {
  constructor(private readonly redis: Redis) {}

  private key(value: ProcessedMessageKey): string {
    return `processed_message:${value.channel}:${value.externalMessageId}`;
  }

  async exists(key: ProcessedMessageKey): Promise<boolean> {
    const result = await this.redis.exists(this.key(key));
    return result === 1;
  }

  async markAsProcessed(key: ProcessedMessageKey): Promise<void> {
    await this.redis.setex(this.key(key), PROCESSED_MESSAGE_TTL_SECONDS, '1');
  }
}
