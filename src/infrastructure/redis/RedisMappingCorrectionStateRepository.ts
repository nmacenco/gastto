// LAYER: Infrastructure
// Redis-backed adapter for the transient mapping-correction state (HU-4.06).
// Serializes the correction state to JSON and stores it with a configurable TTL.
// The main conversation FSM state remains in PostgreSQL (ADR-003).

import type { Redis } from 'ioredis';
import type {
  IMappingCorrectionStateRepository,
  MappingCorrectionStateSnapshot,
} from '../../domain/ports/repositories';

export class RedisMappingCorrectionStateRepository implements IMappingCorrectionStateRepository {
  constructor(private readonly redis: Redis) {}

  private key(userId: string): string {
    return `conversation:${userId}:mapping-correction`;
  }

  async save(
    userId: string,
    state: MappingCorrectionStateSnapshot,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.setex(this.key(userId), ttlSeconds, JSON.stringify(state));
  }

  async load(userId: string): Promise<MappingCorrectionStateSnapshot | null> {
    const raw = await this.redis.get(this.key(userId));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as MappingCorrectionStateSnapshot;
      return parsed;
    } catch {
      return null;
    }
  }

  async clear(userId: string): Promise<void> {
    await this.redis.del(this.key(userId));
  }
}
