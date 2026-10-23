// LAYER: Domain
// Stable parent-first category/subcategory classification result.

import type { CategoryConfidence } from '../entities/ExpenseRecord';

export type ClassificationStatus = 'confirmed' | 'ambiguous' | 'fallback' | 'none';

export interface ClassificationSelection {
  readonly id: string | null;
  readonly name: string | null;
  readonly status: ClassificationStatus;
  readonly confidence: CategoryConfidence;
}

export interface SubcategoryClassificationSelection extends ClassificationSelection {
  readonly categoryId: string | null;
}

export interface HierarchicalClassificationResult {
  readonly category: ClassificationSelection;
  readonly subcategory: SubcategoryClassificationSelection;
}

export const ClassificationSelection = {
  confirmed(
    id: string,
    name: string,
    confidence: CategoryConfidence = 'alta',
  ): ClassificationSelection {
    return { id, name, status: 'confirmed', confidence };
  },

  ambiguous(
    id: string,
    name: string,
    confidence: CategoryConfidence = 'baja',
  ): ClassificationSelection {
    return { id, name, status: 'ambiguous', confidence };
  },

  fallback(
    id: string,
    name: string,
    confidence: CategoryConfidence = 'baja',
  ): ClassificationSelection {
    return { id, name, status: 'fallback', confidence };
  },

  none(): ClassificationSelection {
    return { id: null, name: null, status: 'none', confidence: 'nula' };
  },
};

export const SubcategoryClassificationSelection = {
  confirmed(
    id: string,
    name: string,
    categoryId: string,
    confidence: CategoryConfidence = 'alta',
  ): SubcategoryClassificationSelection {
    return { ...ClassificationSelection.confirmed(id, name, confidence), categoryId };
  },

  ambiguous(
    id: string,
    name: string,
    categoryId: string,
    confidence: CategoryConfidence = 'baja',
  ): SubcategoryClassificationSelection {
    return { ...ClassificationSelection.ambiguous(id, name, confidence), categoryId };
  },

  fallback(
    id: string,
    name: string,
    categoryId: string,
    confidence: CategoryConfidence = 'baja',
  ): SubcategoryClassificationSelection {
    return { ...ClassificationSelection.fallback(id, name, confidence), categoryId };
  },

  none(): SubcategoryClassificationSelection {
    return { ...ClassificationSelection.none(), categoryId: null };
  },
};

export const HierarchicalClassificationResult = {
  create(
    category: ClassificationSelection,
    subcategory: SubcategoryClassificationSelection = SubcategoryClassificationSelection.none(),
  ): HierarchicalClassificationResult {
    return { category, subcategory };
  },

  none(): HierarchicalClassificationResult {
    return {
      category: ClassificationSelection.none(),
      subcategory: SubcategoryClassificationSelection.none(),
    };
  },
};

export function isConfirmedSelection(selection: ClassificationSelection): boolean {
  return selection.status === 'confirmed';
}

export function isAmbiguousSelection(selection: ClassificationSelection): boolean {
  return selection.status === 'ambiguous';
}

export function isFallbackSelection(selection: ClassificationSelection): boolean {
  return selection.status === 'fallback';
}

export function isNoneSelection(selection: ClassificationSelection): boolean {
  return selection.status === 'none';
}
