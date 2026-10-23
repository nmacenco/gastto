import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';
import type * as schema from '../schema';
import { DrizzleCategoryVocabularyRepository } from './DrizzleCategoryVocabularyRepository';

type CategoryRow = typeof schema.userCategories.$inferSelect;
type SubcategoryRow = typeof schema.userSubcategories.$inferSelect;

function categoryRow(overrides: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: 'cat-food',
    spreadsheetId: 'sheet-1',
    rawValue: 'Food',
    normalizedValue: 'food',
    usageCount: 0,
    isActive: true,
    createdAt: new Date('2026-09-03T00:00:00Z'),
    ...overrides,
  };
}

function subcategoryRow(overrides: Partial<SubcategoryRow> = {}): SubcategoryRow {
  return {
    id: 'sub-restaurant',
    categoryId: 'cat-food',
    rawValue: 'Restaurant',
    normalizedValue: 'restaurant',
    usageCount: 0,
    isActive: true,
    createdAt: new Date('2026-09-03T00:00:00Z'),
    ...overrides,
  };
}

function queryMock(results: unknown[][]) {
  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? [])),
    }),
  }));
}

function persistenceMocks(results: unknown[][]) {
  const operations: Array<{ kind: 'insert' | 'update'; values: Record<string, unknown> }> = [];
  const select = queryMock(results);
  const insert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
      operations.push({ kind: 'insert', values });
      return Promise.resolve();
    }),
  }));
  const update = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation((values: Record<string, unknown>) => ({
      where: vi.fn().mockImplementation(() => {
        operations.push({ kind: 'update', values });
        return Promise.resolve();
      }),
    })),
  }));
  const tx = { select, insert, update };
  const transaction = vi
    .fn()
    .mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx));
  const db = { transaction } as unknown as PostgresJsDatabase<typeof schema>;

  return { db, insert, operations, select, transaction };
}

describe('DrizzleCategoryVocabularyRepository', () => {
  describe('findBySpreadsheetId', () => {
    it('returns null without querying children when no active parent exists', async () => {
      const select = queryMock([[]]);
      const db = { select } as unknown as PostgresJsDatabase<typeof schema>;

      await expect(
        new DrizzleCategoryVocabularyRepository(db).findBySpreadsheetId('sheet-1'),
      ).resolves.toBeNull();
      expect(select).toHaveBeenCalledOnce();
    });

    it('loads stable ids and only children returned for active parent ids', async () => {
      const food = categoryRow();
      const leisure = categoryRow({
        id: 'cat-leisure',
        rawValue: 'Leisure',
        normalizedValue: 'leisure',
      });
      const restaurant = subcategoryRow();
      const select = queryMock([[food, leisure], [restaurant]]);
      const db = { select } as unknown as PostgresJsDatabase<typeof schema>;

      const result = await new DrizzleCategoryVocabularyRepository(db).findBySpreadsheetId(
        'sheet-1',
      );

      expect(result?.getCategories()).toEqual([
        { id: food.id, name: food.rawValue, normalizedName: food.normalizedValue },
        { id: leisure.id, name: leisure.rawValue, normalizedName: leisure.normalizedValue },
      ]);
      expect(result?.getSubcategories()).toEqual([
        {
          id: restaurant.id,
          categoryId: food.id,
          name: restaurant.rawValue,
          normalizedName: restaurant.normalizedValue,
        },
      ]);
      expect(select).toHaveBeenCalledTimes(2);
    });
  });

  describe('save', () => {
    it('reads and persists the complete hierarchy inside one transaction, parents first', async () => {
      const { db, operations, select, transaction } = persistenceMocks([[], []]);
      const vocabulary = new CategoryVocabulary('sheet-1');
      const parent = vocabulary.addCategory('Food');
      const child = vocabulary.addSubcategory(parent.id, 'Restaurant');

      await new DrizzleCategoryVocabularyRepository(db).save(vocabulary);

      expect(transaction).toHaveBeenCalledOnce();
      expect(select).toHaveBeenCalledOnce();
      expect(operations.map(({ kind }) => kind)).toEqual(['insert', 'insert']);
      expect(operations[0]?.values).toMatchObject({ id: parent.id, rawValue: 'Food' });
      expect(operations[1]?.values).toMatchObject({
        id: child.id,
        categoryId: parent.id,
        rawValue: 'Restaurant',
      });
    });

    it('reactivates a natural-key match and uses its persisted parent id for new children', async () => {
      const persistedParent = categoryRow({ id: 'persisted-parent', isActive: false });
      const { db, operations } = persistenceMocks([[persistedParent], []]);
      const vocabulary = new CategoryVocabulary('sheet-1');
      const generatedParent = vocabulary.addCategory('Food');
      const child = vocabulary.addSubcategory(generatedParent.id, 'Restaurant');

      await new DrizzleCategoryVocabularyRepository(db).save(vocabulary);

      expect(operations[0]).toEqual({
        kind: 'update',
        values: { rawValue: 'Food', isActive: true },
      });
      expect(operations[1]?.kind).toBe('insert');
      expect(operations[1]?.values).toMatchObject({
        id: child.id,
        categoryId: persistedParent.id,
      });
    });

    it('renames and moves a child by stable id without inserting a replacement', async () => {
      const food = categoryRow();
      const leisure = categoryRow({
        id: 'cat-leisure',
        rawValue: 'Leisure',
        normalizedValue: 'leisure',
      });
      const restaurant = subcategoryRow();
      const { db, insert, operations } = persistenceMocks([[food, leisure], [restaurant]]);
      const vocabulary = new CategoryVocabulary(
        'sheet-1',
        [
          { id: food.id, name: food.rawValue, normalizedName: food.normalizedValue },
          { id: leisure.id, name: leisure.rawValue, normalizedName: leisure.normalizedValue },
        ],
        [
          {
            id: restaurant.id,
            categoryId: restaurant.categoryId,
            name: restaurant.rawValue,
            normalizedName: restaurant.normalizedValue,
          },
        ],
      );
      vocabulary.renameSubcategory(restaurant.id, 'Takeout');
      vocabulary.moveSubcategory(restaurant.id, leisure.id);

      await new DrizzleCategoryVocabularyRepository(db).save(vocabulary);

      expect(insert).not.toHaveBeenCalled();
      expect(operations).toContainEqual({
        kind: 'update',
        values: {
          categoryId: leisure.id,
          rawValue: 'Takeout',
          normalizedValue: 'takeout',
          isActive: true,
        },
      });
    });

    it('soft-disables removed children before their removed parent', async () => {
      const food = categoryRow();
      const leisure = categoryRow({
        id: 'cat-leisure',
        rawValue: 'Leisure',
        normalizedValue: 'leisure',
      });
      const restaurant = subcategoryRow();
      const { db, operations } = persistenceMocks([[food, leisure], [restaurant]]);
      const vocabulary = new CategoryVocabulary('sheet-1', [
        { id: leisure.id, name: leisure.rawValue, normalizedName: leisure.normalizedValue },
      ]);

      await new DrizzleCategoryVocabularyRepository(db).save(vocabulary);

      expect(operations.slice(-2)).toEqual([
        { kind: 'update', values: { isActive: false } },
        { kind: 'update', values: { isActive: false } },
      ]);
    });

    it('propagates child failures so the database transaction can roll back everything', async () => {
      const select = queryMock([[], []]);
      const insert = vi
        .fn()
        .mockReturnValueOnce({ values: vi.fn().mockResolvedValue(undefined) })
        .mockReturnValueOnce({ values: vi.fn().mockRejectedValue(new Error('child failed')) });
      const tx = { select, insert, update: vi.fn() };
      const transaction = vi
        .fn()
        .mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
        );
      const db = { transaction } as unknown as PostgresJsDatabase<typeof schema>;
      const vocabulary = new CategoryVocabulary('sheet-1');
      const parent = vocabulary.addCategory('Food');
      vocabulary.addSubcategory(parent.id, 'Restaurant');

      await expect(new DrizzleCategoryVocabularyRepository(db).save(vocabulary)).rejects.toThrow(
        'child failed',
      );
      expect(transaction).toHaveBeenCalledOnce();
    });
  });
});
