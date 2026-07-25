// LAYER: Application / Tests
// Unit tests for the deterministic keyword-based category classifier.
// All external ports are mocked; business logic is tested in isolation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClassifyExpenseCategory } from './ClassifyExpenseCategory';
import type { ICategoryKeywordVocabularyRepository } from '../../ports/output/categoryKeywordVocabularyRepository.port';
import type { ICategoryFallbackMapper } from '../../ports/output/categoryFallbackMapper.port';
import type { CanonicalCategory } from '../../../domain/value-objects/CategoryKeywordVocabulary';
import { CategoryKeywordVocabulary } from '../../../domain/value-objects/CategoryKeywordVocabulary';
import {
  isHighConfidenceResult,
  isAmbiguousResult,
  isFallbackResult,
  isNoMatchResult,
} from '../../../domain/value-objects/ClassificationResult';
import type { ClassifyExpenseCategoryInput } from '../../ports/in/categoryClassifier.port';

const DEFAULT_THRESHOLD = 0.6;

const mockFindByUserId = vi.fn();
const mockFindClosest = vi.fn();

function buildMockVocabularyRepo(
  userCategories: readonly string[],
): ICategoryKeywordVocabularyRepository {
  mockFindByUserId.mockResolvedValue(
    CategoryKeywordVocabulary.createBase().withUserCategories(userCategories),
  );
  return { findByUserId: mockFindByUserId };
}

function buildMockFallbackMapper(
  mapping: Partial<Record<CanonicalCategory, string | null>> = {},
): ICategoryFallbackMapper {
  mockFindClosest.mockImplementation((inferred: CanonicalCategory) => {
    return Promise.resolve(mapping[inferred] ?? null);
  });
  return { findClosest: mockFindClosest };
}

function buildUseCase(
  userCategories: readonly string[] = [],
  fallbackMapping: Partial<Record<CanonicalCategory, string | null>> = {},
  threshold = DEFAULT_THRESHOLD,
) {
  const vocabularyRepo = buildMockVocabularyRepo(userCategories);
  const fallbackMapper = buildMockFallbackMapper(fallbackMapping);
  const useCase = new ClassifyExpenseCategory(vocabularyRepo, fallbackMapper, threshold);

  return { useCase };
}

function buildInput(overrides: Partial<ClassifyExpenseCategoryInput> = {}): ClassifyExpenseCategoryInput {
  return {
    userId: 'user-123',
    rawMessage: '',
    llmCategory: null,
    llmConfidence: 'nula',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClassifyExpenseCategory', () => {
  describe('unambiguous keyword matching', () => {
    it('returns high-confidence when a single unambiguous keyword dominates', async () => {
      const { useCase } = buildUseCase(['Comida']);

      const result = await useCase.execute(buildInput({ rawMessage: 'almuerzo' }));

      expect(isHighConfidenceResult(result)).toBe(true);
      if (isHighConfidenceResult(result)) {
        expect(result.category).toBe('Comida');
      }
    });

    it('returns high-confidence when multiple keywords all point to the same category', async () => {
      const { useCase } = buildUseCase(['Transporte']);

      const result = await useCase.execute(buildInput({ rawMessage: 'combustible auto' }));

      expect(isHighConfidenceResult(result)).toBe(true);
      if (isHighConfidenceResult(result)) {
        expect(result.category).toBe('Transporte');
      }
    });
  });

  describe('ambiguous keyword matching', () => {
    it('returns ambiguous when two categories have similar scores below the threshold', async () => {
      const { useCase } = buildUseCase(['Comida', 'Transporte']);

      const result = await useCase.execute(buildInput({ rawMessage: 'almuerzo y taxi' }));

      expect(isAmbiguousResult(result)).toBe(true);
      if (isAmbiguousResult(result)) {
        expect(result.category).toBe('Comida');
      }
    });

    it('returns ambiguous when the top confidence is below the threshold', async () => {
      const { useCase } = buildUseCase(['Comida', 'Ocio']);

      const result = await useCase.execute(
        buildInput({ rawMessage: 'cine y almuerzo con amigos' }),
      );

      expect(isAmbiguousResult(result)).toBe(true);
      if (isAmbiguousResult(result)) {
        expect(['Comida', 'Ocio']).toContain(result.category);
      }
    });
  });

  describe('no keyword match', () => {
    it('returns no-match when the message contains no relevant keywords', async () => {
      const { useCase } = buildUseCase(['Comida']);

      const result = await useCase.execute(buildInput({ rawMessage: 'Gasté 50 euros hoy' }));

      expect(isNoMatchResult(result)).toBe(true);
    });
  });

  describe('fallback mapping', () => {
    it('returns fallback when the inferred canonical category is not in user categories', async () => {
      const { useCase } = buildUseCase(
        ['Comida'],
        { entertainment: 'Comida' },
      );

      const result = await useCase.execute(buildInput({ rawMessage: 'Pagué el entretenimiento' }));

      expect(isFallbackResult(result)).toBe(true);
      if (isFallbackResult(result)) {
        expect(result.category).toBe('Comida');
      }
      expect(mockFindClosest).toHaveBeenCalledWith('entertainment', ['Comida']);
    });

    it('returns no-match when the fallback mapper cannot find a reasonable match', async () => {
      const { useCase } = buildUseCase(['Comida'], {});

      const result = await useCase.execute(buildInput({ rawMessage: 'Pagué el entretenimiento' }));

      expect(isNoMatchResult(result)).toBe(true);
    });
  });

  describe('LLM high-confidence short-circuit', () => {
    it('confirms an LLM high-confidence category that exists in the user vocabulary', async () => {
      const { useCase } = buildUseCase(['Comida', 'Transporte']);

      const result = await useCase.execute(
        buildInput({
          rawMessage: 'something',
          llmCategory: 'Comida',
          llmConfidence: 'alta',
        }),
      );

      expect(isHighConfidenceResult(result)).toBe(true);
      if (isHighConfidenceResult(result)) {
        expect(result.category).toBe('Comida');
      }
      expect(mockFindByUserId).toHaveBeenCalledWith('user-123');
      expect(mockFindClosest).not.toHaveBeenCalled();
    });

    it('falls back to keyword matching when the LLM confidence is low', async () => {
      const { useCase } = buildUseCase(['Comida']);

      const result = await useCase.execute(
        buildInput({
          rawMessage: 'almuerzo',
          llmCategory: 'Comida',
          llmConfidence: 'baja',
        }),
      );

      expect(isHighConfidenceResult(result)).toBe(true);
      if (isHighConfidenceResult(result)) {
        expect(result.category).toBe('Comida');
      }
    });

    it('falls back to keyword matching when the LLM category is not in the user vocabulary', async () => {
      const { useCase } = buildUseCase(['Comida']);

      const result = await useCase.execute(
        buildInput({
          rawMessage: 'almuerzo',
          llmCategory: 'Salud',
          llmConfidence: 'alta',
        }),
      );

      expect(isHighConfidenceResult(result)).toBe(true);
      if (isHighConfidenceResult(result)) {
        expect(result.category).toBe('Comida');
      }
    });

    it('returns no-match when the LLM category is missing and no keyword matches', async () => {
      const { useCase } = buildUseCase(['Comida']);

      const result = await useCase.execute(
        buildInput({
          rawMessage: 'Gasté 50 euros hoy',
          llmCategory: null,
          llmConfidence: 'nula',
        }),
      );

      expect(isNoMatchResult(result)).toBe(true);
    });
  });

  describe('case and diacritic normalization', () => {
    it('matches keywords ignoring case and diacritics', async () => {
      const { useCase } = buildUseCase(['Salud']);

      const result = await useCase.execute(buildInput({ rawMessage: 'MÉDICO y remedios' }));

      expect(isHighConfidenceResult(result)).toBe(true);
      if (isHighConfidenceResult(result)) {
        expect(result.category).toBe('Salud');
      }
    });
  });
});
