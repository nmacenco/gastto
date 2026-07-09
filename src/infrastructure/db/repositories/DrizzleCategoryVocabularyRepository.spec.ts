// LAYER: Infrastructure / Tests
// Unit tests for DrizzleCategoryVocabularyRepository.
// Mocks Drizzle ORM database interface to avoid external DB dependency.

import { describe, it, expect, vi } from 'vitest';
import { DrizzleCategoryVocabularyRepository } from './DrizzleCategoryVocabularyRepository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';

function buildUserCategoryRow(
  overrides: Partial<typeof schema.userCategories.$inferSelect> = {},
) {
  return {
    id: 'cat-123',
    spreadsheetId: 'sheet-123',
    rawValue: 'Food',
    normalizedValue: 'food',
    usageCount: 0,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('DrizzleCategoryVocabularyRepository', () => {
  describe('findBySpreadsheetId', () => {
    it('returns a CategoryVocabulary when active rows exist', async () => {
      const rows = [
        buildUserCategoryRow({ id: 'cat-1', rawValue: 'Food', normalizedValue: 'food' }),
        buildUserCategoryRow({ id: 'cat-2', rawValue: 'Transport', normalizedValue: 'transport' }),
      ];
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleCategoryVocabularyRepository(db);
      const result = await repo.findBySpreadsheetId('sheet-123');

      expect(result).not.toBeNull();
      expect(result?.spreadsheetId).toBe('sheet-123');
      expect(result?.getCategories()).toHaveLength(2);
      expect(result?.getCategories()[0]).toEqual({
        id: 'cat-1',
        name: 'Food',
        normalizedName: 'food',
      });
    });

    it('returns null when no active rows exist', async () => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleCategoryVocabularyRepository(db);
      const result = await repo.findBySpreadsheetId('sheet-999');

      expect(result).toBeNull();
    });
  });

  describe('save', () => {
    it('inserts new categories when vocabulary is empty in DB', async () => {
      const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
      const insertMock = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: onConflictDoUpdateMock,
        }),
      });
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
        insert: insertMock,
        transaction: vi.fn().mockImplementation(
          async (fn: (tx: typeof db) => Promise<unknown>) => {
            await fn(db);
          },
        ),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const vocabulary = new CategoryVocabulary('sheet-123');
      vocabulary.addCategory('Food');
      vocabulary.addCategory('Transport');

      const repo = new DrizzleCategoryVocabularyRepository(db);
      await repo.save(vocabulary);

      expect(insertMock).toHaveBeenCalledTimes(2);
    });

    it('soft-deletes categories removed from the vocabulary', async () => {
      const existingRows = [
        buildUserCategoryRow({ id: 'cat-1', normalizedValue: 'food' }),
        buildUserCategoryRow({ id: 'cat-2', normalizedValue: 'transport' }),
      ];
      const updateMock = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });
      const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
      const insertMock = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: onConflictDoUpdateMock,
        }),
      });
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(existingRows),
          }),
        }),
        update: updateMock,
        insert: insertMock,
        transaction: vi.fn().mockImplementation(
          async (fn: (tx: typeof db) => Promise<unknown>) => {
            await fn(db);
          },
        ),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const vocabulary = new CategoryVocabulary('sheet-123');
      vocabulary.addCategory('Food');
      // Transport is intentionally omitted -> should be soft-deleted

      const repo = new DrizzleCategoryVocabularyRepository(db);
      await repo.save(vocabulary);

      expect(updateMock).toHaveBeenCalledTimes(1);
    });

    it('reactivates previously soft-deleted categories via upsert', async () => {
      const existingRows = [
        buildUserCategoryRow({ id: 'cat-1', normalizedValue: 'food', isActive: false }),
      ];
      const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
      const insertMock = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: onConflictDoUpdateMock,
        }),
      });
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(existingRows),
          }),
        }),
        insert: insertMock,
        transaction: vi.fn().mockImplementation(
          async (fn: (tx: typeof db) => Promise<unknown>) => {
            await fn(db);
          },
        ),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const vocabulary = new CategoryVocabulary('sheet-123');
      vocabulary.addCategory('Food');

      const repo = new DrizzleCategoryVocabularyRepository(db);
      await repo.save(vocabulary);

      expect(insertMock).toHaveBeenCalledTimes(1);
      expect(onConflictDoUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          set: { rawValue: 'Food', isActive: true },
        }),
      );
    });
  });
});
