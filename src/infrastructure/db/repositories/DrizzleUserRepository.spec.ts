// LAYER: Infrastructure / Tests
// Unit tests for DrizzleUserRepository.
// Mocks Drizzle ORM database interface and Redis to avoid external dependencies.

import { describe, it, expect, vi } from 'vitest';
import { DrizzleUserRepository } from './DrizzleUserRepository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Redis } from 'ioredis';
import type * as schema from '../schema';

function buildMockRedis(): Redis {
  return {
    get: vi.fn(),
    setex: vi.fn().mockResolvedValue('OK'),
  } as unknown as Redis;
}

function buildIdentityRow(overrides: Partial<typeof schema.messagingIdentities.$inferSelect> = {}) {
  return {
    id: 'identity-1',
    userId: 'user-123',
    channel: 'telegram',
    externalId: '123456789',
    linkedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('DrizzleUserRepository', () => {
  describe('findMessagingIdentitiesByUserId', () => {
    it('returns mapped MessagingIdentity array for the given userId', async () => {
      const rows = [
        buildIdentityRow({ channel: 'telegram', externalId: '111' }),
        buildIdentityRow({
          id: 'identity-2',
          channel: 'whatsapp',
          externalId: '5491122334455',
        }),
      ];

      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const redis = buildMockRedis();
      const repo = new DrizzleUserRepository(db, redis);
      const result = await repo.findMessagingIdentitiesByUserId('user-123');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'identity-1',
        userId: 'user-123',
        channel: 'telegram',
        externalId: '111',
        linkedAt: rows[0]!.linkedAt,
      });
      expect(result[1]).toEqual({
        id: 'identity-2',
        userId: 'user-123',
        channel: 'whatsapp',
        externalId: '5491122334455',
        linkedAt: rows[1]!.linkedAt,
      });
    });

    it('returns empty array when no identities exist for the user', async () => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const redis = buildMockRedis();
      const repo = new DrizzleUserRepository(db, redis);
      const result = await repo.findMessagingIdentitiesByUserId('user-999');

      expect(result).toEqual([]);
    });
  });
});
