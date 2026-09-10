// LAYER: Application / Tests

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifyExpenseCategory } from './ClassifyExpenseCategory';
import { CategoryKeywordVocabulary } from '../../../domain/value-objects/CategoryKeywordVocabulary';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';
import type { ClassifyExpenseCategoryInput } from '../../ports/in/categoryClassifier.port';

const findKeywords = vi.fn();
const findHierarchy = vi.fn();
const findCategoryFallback = vi.fn();
const findSubcategoryFallback = vi.fn();

const food = { id: 'category-food', name: 'Food', normalizedName: 'food' };
const leisure = { id: 'category-leisure', name: 'Leisure', normalizedName: 'leisure' };
const foodRestaurant = {
  id: 'subcategory-food-restaurant',
  categoryId: food.id,
  name: 'Restaurant',
  normalizedName: 'restaurant',
};
const leisureRestaurant = {
  id: 'subcategory-leisure-restaurant',
  categoryId: leisure.id,
  name: 'Restaurant',
  normalizedName: 'restaurant',
};
const supermarket = {
  id: 'subcategory-supermarket',
  categoryId: food.id,
  name: 'Supermarket',
  normalizedName: 'supermarket',
};

function input(
  overrides: Partial<ClassifyExpenseCategoryInput> = {},
): ClassifyExpenseCategoryInput {
  return {
    userId: 'user-123',
    spreadsheetId: 'spreadsheet-123',
    rawMessage: '',
    llmCategory: null,
    llmConfidence: 'nula',
    llmSubcategory: null,
    llmSubcategoryConfidence: 'nula',
    ...overrides,
  };
}

function buildUseCase(
  userCategories: readonly string[] = ['Food', 'Leisure'],
  hierarchy: CategoryVocabulary | null = new CategoryVocabulary(
    'spreadsheet-123',
    [food, leisure],
    [foodRestaurant, leisureRestaurant, supermarket],
  ),
) {
  findKeywords.mockResolvedValue(
    CategoryKeywordVocabulary.createBase().withUserCategories(userCategories),
  );
  findHierarchy.mockResolvedValue(hierarchy);
  return new ClassifyExpenseCategory(
    { findByUserId: findKeywords },
    { findBySpreadsheetId: findHierarchy, save: vi.fn() },
    { findClosest: findCategoryFallback },
    { findClosest: findSubcategoryFallback },
    0.6,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  findCategoryFallback.mockResolvedValue(null);
  findSubcategoryFallback.mockReturnValue(null);
});

describe('ClassifyExpenseCategory', () => {
  it('returns stable IDs for exact high-confidence parent and child suggestions', async () => {
    const result = await buildUseCase().execute(
      input({
        llmCategory: 'food',
        llmConfidence: 'alta',
        llmSubcategory: 'restaurant',
        llmSubcategoryConfidence: 'alta',
      }),
    );

    expect(result).toEqual({
      category: { id: food.id, name: 'Food', status: 'confirmed', confidence: 'alta' },
      subcategory: {
        id: foodRestaurant.id,
        name: 'Restaurant',
        categoryId: food.id,
        status: 'confirmed',
        confidence: 'alta',
      },
    });
  });

  it('isolates equal child names to the selected active parent', async () => {
    const result = await buildUseCase().execute(
      input({
        llmCategory: 'Leisure',
        llmConfidence: 'alta',
        llmSubcategory: 'Restaurant',
        llmSubcategoryConfidence: 'alta',
      }),
    );

    expect(result.subcategory.id).toBe(leisureRestaurant.id);
    expect(result.subcategory.categoryId).toBe(leisure.id);
  });

  it('preserves decisive and ambiguous category keyword behavior with active IDs', async () => {
    const spanishHierarchy = new CategoryVocabulary('spreadsheet-123', [
      { ...food, name: 'Comida', normalizedName: 'comida' },
      { ...leisure, name: 'Ocio', normalizedName: 'ocio' },
    ]);
    const confirmed = await buildUseCase(['Comida', 'Ocio'], spanishHierarchy).execute(
      input({ rawMessage: 'almuerzo' }),
    );
    const ambiguous = await buildUseCase(['Comida', 'Ocio'], spanishHierarchy).execute(
      input({ rawMessage: 'almuerzo y cine' }),
    );

    expect(confirmed.category).toMatchObject({ id: food.id, status: 'confirmed' });
    expect(ambiguous.category).toMatchObject({ id: food.id, status: 'ambiguous' });
  });

  it('binds category fallback names to the active hierarchy', async () => {
    findCategoryFallback.mockResolvedValue('Food');
    const result = await buildUseCase(['Food']).execute(input({ rawMessage: 'entretenimiento' }));

    expect(result.category).toEqual({
      id: food.id,
      name: 'Food',
      status: 'fallback',
      confidence: 'baja',
    });
  });

  it('rejects stale keyword or fallback names that are not active', async () => {
    findCategoryFallback.mockResolvedValue('Old category');
    const result = await buildUseCase(
      ['Old category'],
      new CategoryVocabulary('spreadsheet-123', [food]),
    ).execute(input({ rawMessage: 'entretenimiento' }));

    expect(result.category.status).toBe('none');
    expect(result.subcategory).toMatchObject({ status: 'none', categoryId: null });
  });

  it('stops child classification when the parent or hierarchy is unresolved', async () => {
    const noParent = await buildUseCase().execute(input({ rawMessage: 'nothing relevant' }));
    const noHierarchy = await buildUseCase(['Food'], null).execute(
      input({ llmCategory: 'Food', llmConfidence: 'alta', llmSubcategory: 'Restaurant' }),
    );

    expect(noParent.subcategory).toEqual({
      id: null,
      name: null,
      categoryId: null,
      status: 'none',
      confidence: 'nula',
    });
    expect(noHierarchy.category.status).toBe('none');
    expect(findSubcategoryFallback).not.toHaveBeenCalled();
  });

  it('confirms a whole-name child phrase from the raw message independently of parent confidence', async () => {
    const hierarchy = new CategoryVocabulary(
      'spreadsheet-123',
      [
        { ...food, name: 'Comida', normalizedName: 'comida' },
        { ...leisure, name: 'Ocio', normalizedName: 'ocio' },
      ],
      [foodRestaurant],
    );
    const result = await buildUseCase(['Comida', 'Ocio'], hierarchy).execute(
      input({ rawMessage: 'almuerzo en Restaurant y cine' }),
    );

    expect(result.category.status).toBe('ambiguous');
    expect(result.subcategory).toMatchObject({
      id: foodRestaurant.id,
      status: 'confirmed',
      confidence: 'alta',
    });
  });

  it('marks multiple textual child matches ambiguous', async () => {
    const result = await buildUseCase().execute(
      input({
        llmCategory: 'Food',
        llmConfidence: 'alta',
        rawMessage: 'Restaurant or Supermarket',
      }),
    );

    expect(result.subcategory.status).toBe('ambiguous');
    expect(result.subcategory.categoryId).toBe(food.id);
  });

  it('uses a conservative child fallback and rejects inactive child suggestions', async () => {
    findSubcategoryFallback.mockReturnValueOnce('Restaurant');
    const fallback = await buildUseCase().execute(
      input({
        llmCategory: 'Food',
        llmConfidence: 'alta',
        llmSubcategory: 'Restaurante',
        llmSubcategoryConfidence: 'baja',
      }),
    );
    const inactive = await buildUseCase().execute(
      input({
        llmCategory: 'Food',
        llmConfidence: 'alta',
        llmSubcategory: 'Streaming',
        llmSubcategoryConfidence: 'alta',
      }),
    );

    expect(fallback.subcategory).toMatchObject({
      id: foodRestaurant.id,
      status: 'fallback',
      confidence: 'baja',
    });
    expect(inactive.subcategory.status).toBe('none');
  });

  it('does not auto-select a sole child without textual evidence', async () => {
    const hierarchy = new CategoryVocabulary('spreadsheet-123', [food], [foodRestaurant]);
    const result = await buildUseCase(['Food'], hierarchy).execute(
      input({ llmCategory: 'Food', llmConfidence: 'alta', rawMessage: 'paid 20 euros' }),
    );

    expect(result.subcategory.status).toBe('none');
  });

  it('returns no hierarchy selection when no spreadsheet is resolved', async () => {
    const result = await buildUseCase().execute(input({ spreadsheetId: null }));

    expect(result.category.status).toBe('none');
    expect(findKeywords).not.toHaveBeenCalled();
    expect(findHierarchy).not.toHaveBeenCalled();
  });
});
