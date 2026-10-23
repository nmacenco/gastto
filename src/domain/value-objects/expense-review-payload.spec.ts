// LAYER: Domain / Tests

import { describe, expect, it } from 'vitest';
import {
  normalizeExpenseReviewPayload,
  normalizeExtractedExpensePayload,
  tryNormalizeExpenseReviewPayload,
} from './expense-review-payload';

function buildExtracted() {
  return {
    monto: 25,
    moneda: 'EUR',
    categoriaRaw: 'Food',
    subcategoriaRaw: null,
    fechaRaw: '2026-09-08',
    medioPago: null,
    confianzaCategoria: 'alta',
    confianzaSubcategoria: 'nula',
  } as const;
}

function buildReview() {
  return {
    extracted: buildExtracted(),
    rawMessage: 'Lunch 25 EUR',
    resolvedDate: '2026-09-08',
    resolvedCategory: 'Food',
    resolvedCategoryId: 'category-food',
    categoryStatus: 'confirmed',
    resolvedSubcategory: null,
    resolvedSubcategoryId: null,
    subcategoryStatus: 'none',
    subcategoryEnabled: true,
  } as const;
}

describe('expense review payload normalization', () => {
  it('defaults only missing legacy hierarchy fields', () => {
    const {
      subcategoriaRaw: _subcategoriaRaw,
      confianzaSubcategoria: _confianzaSubcategoria,
      ...legacyExtracted
    } = buildExtracted();
    const {
      resolvedSubcategory: _resolvedSubcategory,
      resolvedSubcategoryId: _resolvedSubcategoryId,
      subcategoryStatus: _subcategoryStatus,
      subcategoryEnabled: _subcategoryEnabled,
      ...legacyReview
    } = buildReview();

    expect(
      normalizeExpenseReviewPayload({ ...legacyReview, extracted: legacyExtracted }),
    ).toMatchObject({
      resolvedSubcategory: null,
      resolvedSubcategoryId: null,
      subcategoryStatus: 'none',
      subcategoryEnabled: false,
      extracted: { subcategoriaRaw: null, confianzaSubcategoria: 'nula' },
    });
  });

  it('preserves a canonical selected child and optional metadata', () => {
    const review = {
      ...buildReview(),
      extracted: {
        ...buildExtracted(),
        subcategoriaRaw: 'Restaurant',
        confianzaSubcategoria: 'alta',
      },
      resolvedSubcategory: 'Restaurant',
      resolvedSubcategoryId: 'subcategory-restaurant',
      subcategoryStatus: 'confirmed',
      queueRegisteredCount: 2,
      immediateUndoExpenseId: 'expense-1',
    } as const;

    expect(normalizeExpenseReviewPayload(review)).toEqual(review);
  });

  it.each([
    {
      name: 'a child without a parent',
      value: {
        ...buildReview(),
        resolvedCategory: null,
        resolvedSubcategory: 'Restaurant',
        resolvedSubcategoryId: 'subcategory-restaurant',
        subcategoryStatus: 'confirmed',
      },
    },
    {
      name: 'a disabled hierarchy with a child',
      value: {
        ...buildReview(),
        subcategoryEnabled: false,
        resolvedSubcategory: 'Restaurant',
        resolvedSubcategoryId: 'subcategory-restaurant',
        subcategoryStatus: 'confirmed',
      },
    },
    {
      name: 'a partial child selection',
      value: {
        ...buildReview(),
        resolvedSubcategory: 'Restaurant',
        subcategoryStatus: 'confirmed',
      },
    },
  ])('rejects $name', ({ value }) => {
    expect(() => normalizeExpenseReviewPayload(value)).toThrow();
    expect(tryNormalizeExpenseReviewPayload(value)).toBeNull();
  });

  it('rejects malformed existing extraction and review fields', () => {
    expect(() =>
      normalizeExtractedExpensePayload({ ...buildExtracted(), monto: Infinity }),
    ).toThrow();
    expect(() =>
      normalizeExpenseReviewPayload({ ...buildReview(), queueRegisteredCount: -1 }),
    ).toThrow();
  });
});
