// LAYER: Domain tests
// Pure domain tests for CategoryVocabulary.

import { describe, it, expect } from 'vitest';
import { CategoryVocabulary, DEFAULT_CATEGORY_SET } from './CategoryVocabulary';
import { Category } from './Category';
import type {
  CategoryVocabularyState,
  CategoryVocabularySource,
} from './CategoryVocabulary';

describe('CategoryVocabulary', () => {
  it('creates a vocabulary with default state and source', () => {
    const vocabulary = CategoryVocabulary.create({
      categories: [Category.create({ name: 'Food' })],
    });

    expect(vocabulary.state).toBe<CategoryVocabularyState>('detecting');
    expect(vocabulary.source).toBe<CategoryVocabularySource>('detected');
    expect(vocabulary.categories).toHaveLength(1);
  });

  it('creates a vocabulary from detected category values', () => {
    const vocabulary = CategoryVocabulary.fromDetected([
      'Food',
      'Transportation',
      '  food  ',
    ]);

    expect(vocabulary.state).toBe<CategoryVocabularyState>('confirming');
    expect(vocabulary.source).toBe<CategoryVocabularySource>('detected');
    expect(vocabulary.categories).toHaveLength(3);
    expect(vocabulary.categories[0]!.name).toBe('Food');
    expect(vocabulary.categories[1]!.order).toBe(1);
  });

  it('creates a vocabulary with the default category set', () => {
    const vocabulary = CategoryVocabulary.withDefaults();

    expect(vocabulary.state).toBe<CategoryVocabularyState>('confirming');
    expect(vocabulary.source).toBe<CategoryVocabularySource>('default');
    expect(vocabulary.categories.map((c) => c.name)).toEqual([
      ...DEFAULT_CATEGORY_SET,
    ]);
  });

  it('confirms the vocabulary', () => {
    const vocabulary = CategoryVocabulary.withDefaults().confirm();

    expect(vocabulary.state).toBe<CategoryVocabularyState>('confirmed');
    expect(vocabulary.source).toBe<CategoryVocabularySource>('default');
  });

  describe('addCategory', () => {
    it('adds a new category and switches to editing/user-edited', () => {
      const vocabulary = CategoryVocabulary.fromDetected(['Food']).addCategory(
        'Health',
      );

      expect(vocabulary.state).toBe<CategoryVocabularyState>('editing');
      expect(vocabulary.source).toBe<CategoryVocabularySource>('user-edited');
      expect(vocabulary.categories.map((c) => c.name)).toEqual([
        'Food',
        'Health',
      ]);
      expect(vocabulary.categories[1]!.order).toBe(1);
    });

    it('ignores duplicates case-insensitively and accent-insensitively', () => {
      const vocabulary = CategoryVocabulary.fromDetected(['Food']).addCategory(
        '  food  ',
      );

      expect(vocabulary.categories).toHaveLength(1);
      expect(vocabulary.state).toBe<CategoryVocabularyState>('confirming');
    });
  });

  describe('removeCategory', () => {
    it('removes an existing category', () => {
      const vocabulary = CategoryVocabulary.fromDetected([
        'Food',
        'Transportation',
      ]).removeCategory('Food');

      expect(vocabulary.categories.map((c) => c.name)).toEqual([
        'Transportation',
      ]);
      expect(vocabulary.state).toBe<CategoryVocabularyState>('editing');
    });

    it('returns the same vocabulary when the category is not found', () => {
      const original = CategoryVocabulary.fromDetected(['Food']);
      const vocabulary = original.removeCategory('Health');

      expect(vocabulary.categories).toEqual(original.categories);
      expect(vocabulary.state).toBe<CategoryVocabularyState>('confirming');
    });
  });

  describe('renameCategory', () => {
    it('renames an existing category', () => {
      const vocabulary = CategoryVocabulary.fromDetected([
        'Food',
        'Transportation',
      ]).renameCategory('Food', 'Dining');

      expect(vocabulary.categories.map((c) => c.name)).toEqual([
        'Dining',
        'Transportation',
      ]);
      expect(vocabulary.state).toBe<CategoryVocabularyState>('editing');
    });

    it('is case-insensitive when matching the original name', () => {
      const vocabulary = CategoryVocabulary.fromDetected(['Food']).renameCategory(
        '  food  ',
        'Dining',
      );

      expect(vocabulary.categories[0]!.name).toBe('Dining');
    });

    it('prevents renaming to an existing category', () => {
      const vocabulary = CategoryVocabulary.fromDetected([
        'Food',
        'Transportation',
      ]).renameCategory('Food', 'Transportation');

      expect(vocabulary.categories.map((c) => c.name)).toEqual([
        'Food',
        'Transportation',
      ]);
    });

    it('returns the same vocabulary when the original category is not found', () => {
      const original = CategoryVocabulary.fromDetected(['Food']);
      const vocabulary = original.renameCategory('Health', 'Wellness');

      expect(vocabulary.categories).toEqual(original.categories);
    });
  });

  it('is immutable', () => {
    const original = CategoryVocabulary.fromDetected(['Food']);
    const confirmed = original.confirm();

    expect(original.state).toBe<CategoryVocabularyState>('confirming');
    expect(confirmed.state).toBe<CategoryVocabularyState>('confirmed');
  });
});
