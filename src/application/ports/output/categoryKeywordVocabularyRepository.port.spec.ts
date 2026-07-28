// LAYER: Application / Tests
// Contract tests for ICategoryKeywordVocabularyRepository.
// Verifies the output port returns a domain CategoryKeywordVocabulary.

import { describe, it, expect, vi } from 'vitest';
import type { ICategoryKeywordVocabularyRepository } from './categoryKeywordVocabularyRepository.port';
import { CategoryKeywordVocabulary } from '../../../domain/value-objects/CategoryKeywordVocabulary';

describe('ICategoryKeywordVocabularyRepository contract', () => {
  it('returns a CategoryKeywordVocabulary for a user', async () => {
    const vocabulary = CategoryKeywordVocabulary.createBase().withUserCategories(['Comida']);
    const mockFindByUserId = vi.fn().mockResolvedValue(vocabulary);
    const port: ICategoryKeywordVocabularyRepository = { findByUserId: mockFindByUserId };

    const result = await port.findByUserId('user-123');

    expect(mockFindByUserId).toHaveBeenCalledWith('user-123');
    expect(result.findBestMatch('almuerzo').canonicalCategory).toBe('food');
  });

  it('has the correct method signature', () => {
    const mockFindByUserId = vi.fn().mockResolvedValue(CategoryKeywordVocabulary.createBase());
    const port: ICategoryKeywordVocabularyRepository = { findByUserId: mockFindByUserId };

    expect(typeof port.findByUserId).toBe('function');
  });
});
