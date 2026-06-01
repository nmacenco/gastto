// LAYER: Infrastructure / Tests
// Unit tests for DrizzleConversationStateRepository.
// Mocks Drizzle ORM database interface to avoid external DB dependency.

import { describe, it, expect, vi } from 'vitest';
import { DrizzleConversationStateRepository } from './DrizzleConversationStateRepository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';

function buildStateRow(overrides: Partial<typeof schema.conversationStates.$inferSelect> = {}) {
  return {
    userId: 'user-123',
    currentState: 'IDLE',
    statePayload: null,
    enteredAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('DrizzleConversationStateRepository', () => {
  describe('findByUserId', () => {
    it('returns mapped ConversationState when row exists', async () => {
      const row = buildStateRow({ currentState: 'EXPENSE_REVIEW' });
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([row]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleConversationStateRepository(db);
      const result = await repo.findByUserId('user-123');

      expect(result).toEqual({
        userId: 'user-123',
        currentState: 'EXPENSE_REVIEW',
        statePayload: null,
        enteredAt: row.enteredAt,
        expiresAt: null,
        updatedAt: row.updatedAt,
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

      const repo = new DrizzleConversationStateRepository(db);
      const result = await repo.findByUserId('user-999');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('inserts IDLE state and returns mapped entity', async () => {
      const row = buildStateRow();
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([row]),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleConversationStateRepository(db);
      const result = await repo.create('user-123');

      expect(result.currentState).toBe('IDLE');
      expect(result.userId).toBe('user-123');
      expect(result.statePayload).toBeNull();
      expect(result.expiresAt).toBeNull();
    });

    it('throws when insert returns no row', async () => {
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleConversationStateRepository(db);
      await expect(repo.create('user-123')).rejects.toThrow('Failed to create conversation state');
    });
  });

  describe('transition', () => {
    it('updates state atomically and returns mapped entity', async () => {
      const row = buildStateRow({
        currentState: 'EXPENSE_REVIEW',
        statePayload: { amount: 100 },
        expiresAt: new Date('2026-12-31T23:59:59Z'),
      });
      const db = {
        transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            update: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([row]),
          };
          return cb(tx);
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleConversationStateRepository(db);
      const result = await repo.transition(
        'user-123',
        'EXPENSE_REVIEW',
        { amount: 100 },
        new Date('2026-12-31T23:59:59Z'),
      );

      expect(result.currentState).toBe('EXPENSE_REVIEW');
      expect(result.statePayload).toEqual({ amount: 100 });
      expect(result.expiresAt).toEqual(new Date('2026-12-31T23:59:59Z'));
    });

    it('throws when update returns no row', async () => {
      const db = {
        transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            update: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([]),
          };
          return cb(tx);
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleConversationStateRepository(db);
      await expect(repo.transition('user-123', 'IDLE', null, null)).rejects.toThrow(
        'Failed to transition conversation state',
      );
    });
  });

  describe('findExpired', () => {
    it('returns mapped ConversationState array for expired rows', async () => {
      const row1 = buildStateRow({ userId: 'user-1', currentState: 'EXPENSE_CLARIFYING' });
      const row2 = buildStateRow({ userId: 'user-2', currentState: 'EXPENSE_REVIEW' });
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([row1, row2]),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleConversationStateRepository(db);
      const result = await repo.findExpired();

      expect(result).toHaveLength(2);
      expect(result[0]!.userId).toBe('user-1');
      expect(result[1]!.userId).toBe('user-2');
    });

    it('returns empty array when no expired rows exist', async () => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleConversationStateRepository(db);
      const result = await repo.findExpired();

      expect(result).toEqual([]);
    });
  });
});
