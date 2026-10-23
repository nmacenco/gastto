// LAYER: Domain / Tests

import { describe, expect, it } from 'vitest';
import {
  ClassificationSelection,
  HierarchicalClassificationResult,
  SubcategoryClassificationSelection,
  isAmbiguousSelection,
  isConfirmedSelection,
  isFallbackSelection,
  isNoneSelection,
} from './ClassificationResult';

describe('hierarchical classification result', () => {
  it('constructs stable parent and child selections with independent statuses', () => {
    const category = ClassificationSelection.confirmed('category-food', 'Food');
    const subcategory = SubcategoryClassificationSelection.ambiguous(
      'subcategory-restaurant',
      'Restaurant',
      'category-food',
    );

    expect(HierarchicalClassificationResult.create(category, subcategory)).toEqual({
      category: {
        id: 'category-food',
        name: 'Food',
        status: 'confirmed',
        confidence: 'alta',
      },
      subcategory: {
        id: 'subcategory-restaurant',
        name: 'Restaurant',
        categoryId: 'category-food',
        status: 'ambiguous',
        confidence: 'baja',
      },
    });
  });

  it('constructs explicit fallback and none selections', () => {
    expect(ClassificationSelection.fallback('category-leisure', 'Leisure')).toMatchObject({
      status: 'fallback',
      confidence: 'baja',
    });
    expect(HierarchicalClassificationResult.none()).toEqual({
      category: { id: null, name: null, status: 'none', confidence: 'nula' },
      subcategory: {
        id: null,
        name: null,
        categoryId: null,
        status: 'none',
        confidence: 'nula',
      },
    });
  });

  it('provides status type guards for either hierarchy level', () => {
    expect(isConfirmedSelection(ClassificationSelection.confirmed('id', 'Food'))).toBe(true);
    expect(isAmbiguousSelection(ClassificationSelection.ambiguous('id', 'Food'))).toBe(true);
    expect(isFallbackSelection(ClassificationSelection.fallback('id', 'Food'))).toBe(true);
    expect(isNoneSelection(ClassificationSelection.none())).toBe(true);
  });
});
