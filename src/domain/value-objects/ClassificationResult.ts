// LAYER: Domain
// Discriminated union representing the outcome of a category classification attempt.
// Avoids nullable business semantics by using explicit result states.

import type { CategoryConfidence } from '../entities/ExpenseRecord';

export type ClassificationResult =
  | {
      readonly kind: 'high-confidence';
      readonly category: string;
      readonly confidence: CategoryConfidence;
    }
  | {
      readonly kind: 'ambiguous';
      readonly category: string;
      readonly confidence: CategoryConfidence;
    }
  | {
      readonly kind: 'fallback';
      readonly category: string;
      readonly confidence: CategoryConfidence;
    }
  | { readonly kind: 'no-match'; readonly category: null; readonly confidence: CategoryConfidence };

export function isHighConfidenceResult(result: ClassificationResult): result is {
  readonly kind: 'high-confidence';
  readonly category: string;
  readonly confidence: CategoryConfidence;
} {
  return result.kind === 'high-confidence';
}

export function isAmbiguousResult(result: ClassificationResult): result is {
  readonly kind: 'ambiguous';
  readonly category: string;
  readonly confidence: CategoryConfidence;
} {
  return result.kind === 'ambiguous';
}

export function isFallbackResult(result: ClassificationResult): result is {
  readonly kind: 'fallback';
  readonly category: string;
  readonly confidence: CategoryConfidence;
} {
  return result.kind === 'fallback';
}

export function isNoMatchResult(result: ClassificationResult): result is {
  readonly kind: 'no-match';
  readonly category: null;
  readonly confidence: CategoryConfidence;
} {
  return result.kind === 'no-match';
}

export const ClassificationResult = {
  highConfidence(category: string): ClassificationResult {
    return { kind: 'high-confidence', category, confidence: 'alta' };
  },

  ambiguous(category: string): ClassificationResult {
    return { kind: 'ambiguous', category, confidence: 'baja' };
  },

  fallback(category: string): ClassificationResult {
    return { kind: 'fallback', category, confidence: 'baja' };
  },

  noMatch(): ClassificationResult {
    return { kind: 'no-match', category: null, confidence: 'nula' };
  },
};

export function getClassificationResultCategory(result: ClassificationResult): string | null {
  return result.category;
}

export function isClassificationResultAmbiguous(result: ClassificationResult): boolean {
  return result.kind === 'ambiguous';
}

export function isClassificationResultFallback(result: ClassificationResult): boolean {
  return result.kind === 'fallback';
}
