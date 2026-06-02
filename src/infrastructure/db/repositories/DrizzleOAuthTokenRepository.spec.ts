// LAYER: Infrastructure / Tests
// Unit tests for DrizzleOAuthTokenRepository.
// Mocks Drizzle ORM database interface to avoid external DB dependency.

import { describe, it, expect, vi } from 'vitest';
import { DrizzleOAuthTokenRepository } from './DrizzleOAuthTokenRepository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';

function buildOAuthTokenRow(overrides: Partial<typeof schema.oauthTokens.$inferSelect> = {}) {
  return {
    id: 'token-123',
    userId: 'user-123',
    provider: 'google' as const,
    accessTokenEnc: Buffer.from('enc-access-token'),
    refreshTokenEnc: Buffer.from('enc-refresh-token'),
    iv: Buffer.from('iv-16-bytes-long'),
    accessTokenExpiresAt: new Date('2026-12-31T23:59:59Z'),
    scope: ['https://www.googleapis.com/auth/drive.file'],
    grantedAt: new Date('2026-01-01T00:00:00Z'),
    lastRefreshedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('DrizzleOAuthTokenRepository', () => {
  describe('findByUserAndProvider', () => {
    it('returns mapped OAuthToken when row exists', async () => {
      const row = buildOAuthTokenRow({ provider: 'microsoft' as const });
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([row]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleOAuthTokenRepository(db);
      const result = await repo.findByUserAndProvider('user-123', 'microsoft');

      expect(result).toEqual({
        id: 'token-123',
        userId: 'user-123',
        provider: 'microsoft',
        accessTokenEnc: row.accessTokenEnc,
        refreshTokenEnc: row.refreshTokenEnc,
        iv: row.iv,
        accessTokenExpiresAt: row.accessTokenExpiresAt,
        scope: row.scope,
        grantedAt: row.grantedAt,
        lastRefreshedAt: null,
        revokedAt: null,
      });
    });

    it('returns null when row does not exist', async () => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleOAuthTokenRepository(db);
      const result = await repo.findByUserAndProvider('user-999', 'google');

      expect(result).toBeNull();
    });
  });

  describe('upsert', () => {
    it('inserts a new token and returns mapped entity', async () => {
      const row = buildOAuthTokenRow();
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([row]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleOAuthTokenRepository(db);
      const result = await repo.upsert({
        userId: 'user-123',
        provider: 'google',
        accessTokenEnc: row.accessTokenEnc,
        refreshTokenEnc: row.refreshTokenEnc,
        iv: row.iv,
        accessTokenExpiresAt: row.accessTokenExpiresAt,
        scope: row.scope,
        grantedAt: row.grantedAt,
        lastRefreshedAt: null,
        revokedAt: null,
      });

      expect(result.id).toBe('token-123');
      expect(result.userId).toBe('user-123');
      expect(result.provider).toBe('google');
    });

    it('throws when upsert returns no row', async () => {
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleOAuthTokenRepository(db);
      await expect(
        repo.upsert({
          userId: 'user-123',
          provider: 'google',
          accessTokenEnc: Buffer.from('enc'),
          refreshTokenEnc: Buffer.from('enc'),
          iv: Buffer.from('iv'),
          accessTokenExpiresAt: new Date(),
          scope: [],
          grantedAt: new Date(),
          lastRefreshedAt: null,
          revokedAt: null,
        }),
      ).rejects.toThrow('Failed to upsert OAuth token');
    });
  });

  describe('markRefreshed', () => {
    it('updates token fields and returns void', async () => {
      const row = buildOAuthTokenRow();
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([row]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleOAuthTokenRepository(db);
      await expect(repo.markRevoked('token-123')).resolves.toBeUndefined();
    });

    it('throws when update returns no row', async () => {
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleOAuthTokenRepository(db);
      await expect(
        repo.markRefreshed('token-999', Buffer.from('new'), Buffer.from('iv'), new Date()),
      ).rejects.toThrow('Failed to mark OAuth token as refreshed');
    });
  });

  describe('markRevoked', () => {
    it('sets revokedAt and returns void', async () => {
      const row = buildOAuthTokenRow();
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([row]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleOAuthTokenRepository(db);
      await expect(repo.markRevoked('token-123')).resolves.toBeUndefined();
    });

    it('throws when update returns no row', async () => {
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleOAuthTokenRepository(db);
      await expect(repo.markRevoked('token-999')).rejects.toThrow(
        'Failed to mark OAuth token as revoked',
      );
    });
  });
});
