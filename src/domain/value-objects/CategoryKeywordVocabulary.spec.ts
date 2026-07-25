// LAYER: Domain / Tests
// Unit tests for CategoryKeywordVocabulary base matching and user-category extension.

import { describe, it, expect } from 'vitest';
import { CategoryKeywordVocabulary } from './CategoryKeywordVocabulary';

describe('CategoryKeywordVocabulary', () => {
  describe('createBase', () => {
    it('matches a base keyword to its canonical category', () => {
      const vocabulary = CategoryKeywordVocabulary.createBase();
      const result = vocabulary.findBestMatch('Pagué el almuerzo, 12 euros');

      expect(result.canonicalCategory).toBe('food');
      expect(result.matchedKeywords).toBeGreaterThan(0);
      expect(result.totalKeywords).toBeGreaterThan(0);
    });

    it('is case-insensitive', () => {
      const vocabulary = CategoryKeywordVocabulary.createBase();
      const result = vocabulary.findBestMatch('CARGUE COMBUSTIBLE');

      expect(result.canonicalCategory).toBe('transport');
    });

    it('is diacritic-insensitive', () => {
      const vocabulary = CategoryKeywordVocabulary.createBase();
      const result = vocabulary.findBestMatch('médico y remedios');

      expect(result.canonicalCategory).toBe('health');
    });
  });

  describe('withUserCategories', () => {
    it('extends the vocabulary without mutating the base instance', () => {
      const base = CategoryKeywordVocabulary.createBase();
      const userCategory = 'MiAlimentacion';
      const baseResultBefore = base.findBestMatch(userCategory);
      expect(baseResultBefore.canonicalCategory).toBeNull();

      const extended = base.withUserCategories([userCategory, 'Transporte']);
      const baseResultAfter = base.findBestMatch(userCategory);
      const extendedResult = extended.findBestMatch(userCategory);

      expect(extended).not.toBe(base);
      expect(baseResultAfter).toEqual(baseResultBefore);
      expect(extendedResult.canonicalCategory).toBe('food');
    });

    it('maps user category names to canonical categories when names are similar', () => {
      const vocabulary = CategoryKeywordVocabulary.createBase().withUserCategories([
        'MiAlimentacion',
        'Transporte',
      ]);
      const result = vocabulary.findBestMatch('MiAlimentacion');

      expect(result.canonicalCategory).toBe('food');
    });

    it('keeps base keywords working after extension', () => {
      const vocabulary = CategoryKeywordVocabulary.createBase().withUserCategories([
        'Alimentación',
      ]);
      const result = vocabulary.findBestMatch('Pagué el almuerzo');

      expect(result.canonicalCategory).toBe('food');
    });
  });

  describe('findBestMatch', () => {
    it('returns null when no keyword matches', () => {
      const vocabulary = CategoryKeywordVocabulary.createBase();
      const result = vocabulary.findBestMatch('Gasté 50 euros hoy');

      expect(result.canonicalCategory).toBeNull();
      expect(result.matchedKeywords).toBe(0);
    });

    it('counts multiple keywords pointing to the same category', () => {
      const vocabulary = CategoryKeywordVocabulary.createBase();
      const result = vocabulary.findBestMatch('Cargué combustible para el auto');

      expect(result.canonicalCategory).toBe('transport');
      expect(result.matchedKeywords).toBeGreaterThanOrEqual(2);
    });

    it('handles punctuation and extra whitespace', () => {
      const vocabulary = CategoryKeywordVocabulary.createBase();
      const result = vocabulary.findBestMatch('   café, restaurante...   ');

      expect(result.canonicalCategory).toBe('food');
    });
  });
});
