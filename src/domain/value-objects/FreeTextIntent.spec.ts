// LAYER: Domain / Tests
// Type-level and runtime tests for FreeTextIntent.

import { describe, it, expect } from 'vitest';
import {
  FreeTextIntent,
  isExpenseLikeIntent,
  isNonFinancialIntent,
  isTooLongIntent,
} from './FreeTextIntent';

describe('FreeTextIntent', () => {
  it('narrows correctly in a switch statement', () => {
    function getLabel(intent: FreeTextIntent): string {
      switch (intent.kind) {
        case 'expense-like':
          return 'expense-like';
        case 'non-financial':
          return 'non-financial';
        case 'too-long':
          return 'too-long';
        /* istanbul ignore next */
        default:
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          return `unknown: ${intent}`;
      }
    }

    expect(getLabel({ kind: 'expense-like' })).toBe('expense-like');
    expect(getLabel({ kind: 'non-financial' })).toBe('non-financial');
    expect(getLabel({ kind: 'too-long' })).toBe('too-long');
  });

  it('identifies expense-like intent with isExpenseLikeIntent', () => {
    expect(isExpenseLikeIntent({ kind: 'expense-like' })).toBe(true);
    expect(isExpenseLikeIntent({ kind: 'non-financial' })).toBe(false);
    expect(isExpenseLikeIntent({ kind: 'too-long' })).toBe(false);
  });

  it('identifies non-financial intent with isNonFinancialIntent', () => {
    expect(isNonFinancialIntent({ kind: 'non-financial' })).toBe(true);
    expect(isNonFinancialIntent({ kind: 'expense-like' })).toBe(false);
    expect(isNonFinancialIntent({ kind: 'too-long' })).toBe(false);
  });

  it('identifies too-long intent with isTooLongIntent', () => {
    expect(isTooLongIntent({ kind: 'too-long' })).toBe(true);
    expect(isTooLongIntent({ kind: 'expense-like' })).toBe(false);
    expect(isTooLongIntent({ kind: 'non-financial' })).toBe(false);
  });

  describe('fromText', () => {
    it('classifies a clear expense message as expense-like', () => {
      const intent = FreeTextIntent.fromText('Pagué el almuerzo, 12 euros');
      expect(intent).toEqual({ kind: 'expense-like' });
    });

    it('classifies a partial expense message as expense-like', () => {
      const intent = FreeTextIntent.fromText('Almuerzo 12');
      expect(intent).toEqual({ kind: 'expense-like' });
    });

    it('classifies a non-financial greeting as non-financial', () => {
      expect(FreeTextIntent.fromText('Hola')).toEqual({
        kind: 'non-financial',
      });
      expect(FreeTextIntent.fromText('👋')).toEqual({
        kind: 'non-financial',
      });
    });

    it('classifies a message longer than 500 characters as too-long', () => {
      const longText = 'a'.repeat(501);
      const intent = FreeTextIntent.fromText(longText);
      expect(intent).toEqual({ kind: 'too-long' });
    });

    it('classifies a 500-character message as expense-like when it contains a number', () => {
      const text = 'a'.repeat(498) + ' 1';
      const intent = FreeTextIntent.fromText(text);
      expect(intent).toEqual({ kind: 'expense-like' });
    });

    it('classifies a message with a currency symbol as expense-like', () => {
      expect(FreeTextIntent.fromText('Lunch $12')).toEqual({
        kind: 'expense-like',
      });
    });

    it('classifies a message with an expense verb as expense-like', () => {
      expect(FreeTextIntent.fromText('Compré pan')).toEqual({
        kind: 'expense-like',
      });
    });

    it('classifies an unaccented Spanish expense verb as expense-like', () => {
      expect(FreeTextIntent.fromText('Compre cafe')).toEqual({
        kind: 'expense-like',
      });
    });
  });
});
