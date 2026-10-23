import { describe, expect, it, vi } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';
import { DrizzleUserCategoryRepository } from './DrizzleUserCategoryRepository';

const row: typeof schema.userCategories.$inferSelect = {
  id: 'cat-1',
  spreadsheetId: 'sheet-1',
  rawValue: 'Food',
  normalizedValue: 'food',
  usageCount: 4,
  isActive: true,
  createdAt: new Date('2026-09-03T00:00:00Z'),
};

describe('DrizzleUserCategoryRepository', () => {
  it('filters active rows by spreadsheet and maps every domain field', async () => {
    const where = vi.fn().mockResolvedValue([row]);
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where }),
      }),
    } as unknown as PostgresJsDatabase<typeof schema>;

    await expect(
      new DrizzleUserCategoryRepository(db).findActiveBySpreadsheetId('sheet-1'),
    ).resolves.toEqual([row]);
    expect(where).toHaveBeenCalledOnce();
  });

  it('inserts the supplied id and preserves the persisted id on natural-key conflict', async () => {
    let conflictSet: Record<string, unknown> | undefined;
    const onConflictDoUpdate = vi
      .fn()
      .mockImplementation((config: { set: Record<string, unknown> }) => {
        conflictSet = config.set;
        return Promise.resolve();
      });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const tx = { insert: vi.fn().mockReturnValue({ values }) };
    const transaction = vi
      .fn()
      .mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx));
    const db = { transaction } as unknown as PostgresJsDatabase<typeof schema>;

    await new DrizzleUserCategoryRepository(db).upsertMany([
      {
        id: 'supplied-id',
        spreadsheetId: 'sheet-1',
        rawValue: 'Food',
        normalizedValue: 'food',
        usageCount: 0,
        isActive: true,
      },
    ]);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ id: 'supplied-id' }));
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: { rawValue: 'Food', isActive: true } }),
    );
    expect(conflictSet).not.toHaveProperty('id');
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('does not open a transaction for an empty upsert', async () => {
    const transaction = vi.fn();
    const db = { transaction } as unknown as PostgresJsDatabase<typeof schema>;

    await new DrizzleUserCategoryRepository(db).upsertMany([]);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('increments usage and rejects when no row was updated', async () => {
    const returning = vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const db = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning }),
        }),
      }),
    } as unknown as PostgresJsDatabase<typeof schema>;
    const repository = new DrizzleUserCategoryRepository(db);

    await expect(repository.incrementUsage(row.id)).resolves.toBeUndefined();
    await expect(repository.incrementUsage('missing')).rejects.toThrow(
      'Failed to increment category usage',
    );
  });
});
