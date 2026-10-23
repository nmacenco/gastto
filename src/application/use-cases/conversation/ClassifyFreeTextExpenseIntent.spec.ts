// LAYER: Application / Tests
// Unit tests for ClassifyFreeTextExpenseIntent.

import { describe, it, expect } from 'vitest';
import { ClassifyFreeTextExpenseIntent } from './ClassifyFreeTextExpenseIntent';

describe('ClassifyFreeTextExpenseIntent', () => {
  const classifier = new ClassifyFreeTextExpenseIntent();

  it('classifies a clear expense message as expense-like', () => {
    const intent = classifier.execute('Pagué el almuerzo, 12 euros');
    expect(intent).toEqual({ kind: 'expense-like' });
  });

  it('classifies a partial expense message without currency as expense-like', () => {
    const intent = classifier.execute('Almuerzo 12');
    expect(intent).toEqual({ kind: 'expense-like' });
  });

  it('classifies an unaccented purchase without amount as expense-like', () => {
    const intent = classifier.execute('Compre cafe');
    expect(intent).toEqual({ kind: 'expense-like' });
  });

  it('classifies a non-financial greeting as non-financial', () => {
    expect(classifier.execute('Hola')).toEqual({ kind: 'non-financial' });
    expect(classifier.execute('👋')).toEqual({ kind: 'non-financial' });
    expect(classifier.execute('empezar')).toEqual({ kind: 'non-financial' });
  });

  it('classifies a message longer than 500 characters as too-long', () => {
    const longText = 'a'.repeat(501);
    const intent = classifier.execute(longText);
    expect(intent).toEqual({ kind: 'too-long' });
  });
});
