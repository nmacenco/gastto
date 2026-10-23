// LAYER: Domain / Tests
// Type-level contract tests for category-vocabulary ports.
// Ensures the interfaces satisfy the expected input/output shapes and can be
// implemented by infrastructure adapters.

import { describe, it, expect } from 'vitest';
import { CategoryVocabulary } from '../value-objects/CategoryVocabulary';
import type {
  ReadUniqueCategoriesInput,
  CategoryReaderPort,
  CategoryVocabularyRepositoryPort,
  OnboardingCompletionPort,
} from './categoryVocabulary';

describe('ReadUniqueCategoriesInput', () => {
  it('accepts a complete Google Sheets input', () => {
    const input: ReadUniqueCategoriesInput = {
      provider: 'google',
      fileId: 'spreadsheet-123',
      sheetName: 'Gastos',
      accessToken: 'token',
      columnIndex: 2,
    };

    expect(input.provider).toBe('google');
    expect(input.fileId).toBe('spreadsheet-123');
    expect(input.sheetName).toBe('Gastos');
    expect(input.accessToken).toBe('token');
    expect(input.columnIndex).toBe(2);
  });

  it('accepts a Microsoft Excel input', () => {
    const input: ReadUniqueCategoriesInput = {
      provider: 'microsoft',
      fileId: 'workbook-456',
      sheetName: 'Hoja1',
      accessToken: 'ms-token',
      columnIndex: 0,
    };

    expect(input.provider).toBe('microsoft');
    expect(input.columnIndex).toBe(0);
  });
});

describe('CategoryReaderPort', () => {
  it('can be implemented by an adapter', async () => {
    const adapter: CategoryReaderPort = {
      readUniqueCategories: (_input) => Promise.resolve(['Food', 'Transportation']),
    };

    const result = await adapter.readUniqueCategories({
      provider: 'google',
      fileId: 'id',
      sheetName: 'sheet',
      accessToken: 'token',
      columnIndex: 1,
    });

    expect(result).toEqual(['Food', 'Transportation']);
  });
});

describe('CategoryVocabularyRepositoryPort', () => {
  it('can be implemented by a repository', async () => {
    let saved: { userId: string; vocabulary: CategoryVocabulary; ttlSeconds: number } | null = null;

    const repository: CategoryVocabularyRepositoryPort = {
      save: (userId, vocabulary, ttlSeconds) => {
        saved = { userId, vocabulary, ttlSeconds };
        return Promise.resolve();
      },
      load: (_userId) => Promise.resolve(null),
    };

    const vocabulary = CategoryVocabulary.withDefaults();
    await repository.save('user-123', vocabulary, 3600);

    expect(saved).not.toBeNull();
    expect(saved!.userId).toBe('user-123');
    expect(saved!.vocabulary).toBe(vocabulary);
    expect(saved!.ttlSeconds).toBe(3600);
  });

  it('can return a persisted vocabulary on load', async () => {
    const vocabulary = CategoryVocabulary.withDefaults();

    const repository: CategoryVocabularyRepositoryPort = {
      save: () => Promise.resolve(),
      load: (_userId) => Promise.resolve(vocabulary),
    };

    const loaded = await repository.load('user-123');
    expect(loaded).toBe(vocabulary);
  });

  it('can return null when no vocabulary is stored', async () => {
    const repository: CategoryVocabularyRepositoryPort = {
      save: () => Promise.resolve(),
      load: (_userId) => Promise.resolve(null),
    };

    const loaded = await repository.load('user-123');
    expect(loaded).toBeNull();
  });
});

describe('OnboardingCompletionPort', () => {
  it('can be implemented by a completion handler', async () => {
    let completedUserId: string | null = null;

    const completion: OnboardingCompletionPort = {
      complete: (userId) => {
        completedUserId = userId;
        return Promise.resolve();
      },
    };

    await completion.complete('user-123');
    expect(completedUserId).toBe('user-123');
  });
});
