// LAYER: Domain / Tests
// Unit tests for ClassificationResult discriminated union and factory constructors.

import { describe, it, expect } from 'vitest';
import {
  ClassificationResult,
  isHighConfidenceResult,
  isAmbiguousResult,
  isFallbackResult,
  isNoMatchResult,
  getClassificationResultCategory,
  isClassificationResultAmbiguous,
  isClassificationResultFallback,
} from './ClassificationResult';

describe('ClassificationResult', () => {
  describe('factory constructors', () => {
    it('creates a high-confidence result', () => {
      const result = ClassificationResult.highConfidence('Comida');
      expect(result).toEqual({
        kind: 'high-confidence',
        category: 'Comida',
        confidence: 'alta',
      });
    });

    it('creates an ambiguous result', () => {
      const result = ClassificationResult.ambiguous('Transporte');
      expect(result).toEqual({
        kind: 'ambiguous',
        category: 'Transporte',
        confidence: 'baja',
      });
    });

    it('creates a fallback result', () => {
      const result = ClassificationResult.fallback('Ocio');
      expect(result).toEqual({
        kind: 'fallback',
        category: 'Ocio',
        confidence: 'baja',
      });
    });

    it('creates a no-match result', () => {
      const result = ClassificationResult.noMatch();
      expect(result).toEqual({
        kind: 'no-match',
        category: null,
        confidence: 'nula',
      });
    });
  });

  describe('type guards', () => {
    it('narrows high-confidence correctly', () => {
      const result = ClassificationResult.highConfidence('Comida');
      expect(isHighConfidenceResult(result)).toBe(true);
      expect(isAmbiguousResult(result)).toBe(false);
      expect(isFallbackResult(result)).toBe(false);
      expect(isNoMatchResult(result)).toBe(false);
    });

    it('narrows ambiguous correctly', () => {
      const result = ClassificationResult.ambiguous('Transporte');
      expect(isAmbiguousResult(result)).toBe(true);
      expect(isHighConfidenceResult(result)).toBe(false);
    });

    it('narrows fallback correctly', () => {
      const result = ClassificationResult.fallback('Ocio');
      expect(isFallbackResult(result)).toBe(true);
      expect(isNoMatchResult(result)).toBe(false);
    });

    it('narrows no-match correctly', () => {
      const result = ClassificationResult.noMatch();
      expect(isNoMatchResult(result)).toBe(true);
      expect(isHighConfidenceResult(result)).toBe(false);
    });
  });

  describe('discriminated union exhaustiveness', () => {
    it('can be narrowed in a switch statement', () => {
      function getLabel(result: ClassificationResult): string {
        switch (result.kind) {
          case 'high-confidence':
            return `high:${result.category}`;
          case 'ambiguous':
            return `ambiguous:${result.category}`;
          case 'fallback':
            return `fallback:${result.category}`;
          case 'no-match':
            return 'no-match';
          /* istanbul ignore next */
          default:
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            return `unknown: ${result}`;
        }
      }

      expect(getLabel(ClassificationResult.highConfidence('Comida'))).toBe('high:Comida');
      expect(getLabel(ClassificationResult.ambiguous('Transporte'))).toBe('ambiguous:Transporte');
      expect(getLabel(ClassificationResult.fallback('Ocio'))).toBe('fallback:Ocio');
      expect(getLabel(ClassificationResult.noMatch())).toBe('no-match');
    });
  });

  describe('helpers', () => {
    it('returns the category for matched results', () => {
      expect(getClassificationResultCategory(ClassificationResult.highConfidence('Comida'))).toBe(
        'Comida',
      );
      expect(getClassificationResultCategory(ClassificationResult.noMatch())).toBeNull();
    });

    it('detects ambiguity and fallback flags', () => {
      expect(isClassificationResultAmbiguous(ClassificationResult.ambiguous('X'))).toBe(true);
      expect(isClassificationResultAmbiguous(ClassificationResult.highConfidence('X'))).toBe(false);
      expect(isClassificationResultFallback(ClassificationResult.fallback('X'))).toBe(true);
      expect(isClassificationResultFallback(ClassificationResult.noMatch())).toBe(false);
    });
  });
});
