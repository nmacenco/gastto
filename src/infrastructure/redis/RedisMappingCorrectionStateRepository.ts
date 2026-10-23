// LAYER: Infrastructure
// Redis-backed adapter for the transient mapping-correction state (HU-4.06).
// Serializes the correction state to JSON and stores it with a configurable TTL.
// The main conversation FSM state remains in PostgreSQL (ADR-003).

import type { Redis } from 'ioredis';
import type {
  IMappingCorrectionStateRepository,
  MappingCorrectionStateSnapshot,
} from '../../domain/ports/repositories';
import { SUPPORTED_GASTTO_FIELDS } from '../../domain/entities/SpreadsheetConfig';

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
      const parsed: unknown = JSON.parse(raw);
      return this.isValidSnapshot(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async clear(userId: string): Promise<void> {
    await this.redis.del(this.key(userId));
  }

  private isValidSnapshot(value: unknown): value is MappingCorrectionStateSnapshot {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const snapshot = value as Record<string, unknown>;
    if (!Array.isArray(snapshot.originalMapping) || !Array.isArray(snapshot.corrections))
      return false;
    if (!['proposed', 'correcting', 'confirmed'].includes(String(snapshot.status))) return false;

    return snapshot.originalMapping.every((mapping) => {
      if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) return false;
      const record = mapping as Record<string, unknown>;
      return (
        typeof record.GasttoField === 'string' &&
        SUPPORTED_GASTTO_FIELDS.includes(
          record.GasttoField as (typeof SUPPORTED_GASTTO_FIELDS)[number],
        ) &&
        typeof record.columnIndex === 'number' &&
        Number.isInteger(record.columnIndex) &&
        typeof record.columnHeader === 'string'
      );
    });
  }
}
