import { describe, expect, it, vi } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';
import { DrizzleExpenseQueueRepository } from './DrizzleExpenseQueueRepository';

function buildRow(overrides: Partial<typeof schema.expenseQueue.$inferSelect> = {}) {
  return {
    id: 'queue-1',
    userId: 'user-1',
    position: 1,
    rawMessage: 'Taxi 12 EUR',
    receivedAt: new Date('2026-08-05T10:00:00Z'),
    channel: 'telegram',
    ...overrides,
  };
}

describe('DrizzleExpenseQueueRepository', () => {
  it('returns queue items ordered by their FIFO position', async () => {
    const rows = [buildRow(), buildRow({ id: 'queue-2', position: 2, rawMessage: 'Lunch 15 EUR' })];
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) }),
        }),
      }),
    } as unknown as PostgresJsDatabase<typeof schema>;

    await expect(new DrizzleExpenseQueueRepository(db).findByUserId('user-1')).resolves.toEqual(
      rows,
    );
  });

  it('enqueues at the next position transactionally', async () => {
    const inserted = buildRow({ position: 2 });
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([{ position: 1 }]) }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([inserted]) }),
      }),
    };
    const db = {
      transaction: vi.fn((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PostgresJsDatabase<typeof schema>;

    await expect(
      new DrizzleExpenseQueueRepository(db).enqueue('user-1', 'Lunch 15 EUR', 'telegram'),
    ).resolves.toEqual(inserted);
    expect(tx.insert).toHaveBeenCalledOnce();
  });

  it('does not enqueue a third pending expense', async () => {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([{ position: 1 }, { position: 2 }]),
          }),
        }),
      }),
      insert: vi.fn(),
    };
    const db = {
      transaction: vi.fn((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PostgresJsDatabase<typeof schema>;

    await expect(
      new DrizzleExpenseQueueRepository(db).enqueue('user-1', 'Ice cream 5 EUR', 'telegram'),
    ).rejects.toThrow('Expense queue is full');
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('dequeues the oldest item and reindexes the remaining queue transactionally', async () => {
    const first = buildRow();
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([first]) }),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }),
    };
    const db = {
      transaction: vi.fn((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PostgresJsDatabase<typeof schema>;

    await expect(new DrizzleExpenseQueueRepository(db).dequeueFirst('user-1')).resolves.toEqual(
      first,
    );
    expect(tx.delete).toHaveBeenCalledOnce();
    expect(tx.update).toHaveBeenCalledOnce();
  });
});
