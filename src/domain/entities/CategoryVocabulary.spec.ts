// LAYER: Domain / Tests
// Unit tests for CategoryVocabulary aggregate invariants.

import { describe, it, expect } from 'vitest';
import { CategoryVocabulary } from './CategoryVocabulary';
import { DomainValidationError } from '../errors/DomainValidationError';

describe('CategoryVocabulary', () => {
  it('adds a category', () => {
    const vocab = new CategoryVocabulary('sheet-1');
    const category = vocab.addCategory('Food');

    expect(category.name).toBe('Food');
    expect(category.normalizedName).toBe('food');
    expect(vocab.getCategories()).toHaveLength(1);
  });

  it('rejects duplicate normalized names', () => {
    const vocab = new CategoryVocabulary('sheet-1');
    vocab.addCategory('Food');

    expect(() => vocab.addCategory('food')).toThrow(DomainValidationError);
    expect(() => vocab.addCategory('  FOOD  ')).toThrow(DomainValidationError);
  });

  it('rejects empty category names', () => {
    const vocab = new CategoryVocabulary('sheet-1');

    expect(() => vocab.addCategory('')).toThrow(DomainValidationError);
    expect(() => vocab.addCategory('   ')).toThrow(DomainValidationError);
  });

  it('removes a category by id', () => {
    const vocab = new CategoryVocabulary('sheet-1');
    const category = vocab.addCategory('Food');
    vocab.removeCategory(category.id);

    expect(vocab.getCategories()).toHaveLength(0);
  });

  it('renames a category', () => {
    const vocab = new CategoryVocabulary('sheet-1');
    const category = vocab.addCategory('Food');
    const updated = vocab.renameCategory(category.id, 'Groceries');

    expect(updated.name).toBe('Groceries');
    expect(updated.normalizedName).toBe('groceries');
  });

  it('rejects rename to an existing normalized name', () => {
    const vocab = new CategoryVocabulary('sheet-1');
    const food = vocab.addCategory('Food');
    vocab.addCategory('Transport');

    expect(() => vocab.renameCategory(food.id, 'transport')).toThrow(DomainValidationError);
  });

  it('rejects rename to empty name', () => {
    const vocab = new CategoryVocabulary('sheet-1');
    const category = vocab.addCategory('Food');

    expect(() => vocab.renameCategory(category.id, '')).toThrow(DomainValidationError);
  });

  it('throws when renaming a non-existent category', () => {
    const vocab = new CategoryVocabulary('sheet-1');

    expect(() => vocab.renameCategory('non-existent-id', 'Food')).toThrow(DomainValidationError);
  });
});
