// LAYER: Infrastructure / Tests
// Unit tests for DrizzleCategoryKeywordVocabularyRepository.
// All external repositories are mocked; no database is required.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrizzleCategoryKeywordVocabularyRepository } from './DrizzleCategoryKeywordVocabularyRepository';
import type {
  ISpreadsheetConfigRepository,
  IUserCategoryRepository,
} from '../../../domain/ports/repositories';
import type { SpreadsheetConfig } from '../../../domain/entities/SpreadsheetConfig';
import type { UserCategory } from '../../../domain/entities/SpreadsheetConfig';

const mockFindByUserId = vi.fn();
const mockFindActiveBySpreadsheetId = vi.fn();

function buildSpreadsheetConfig(overrides: Partial<SpreadsheetConfig> = {}): SpreadsheetConfig {
  return {
    id: 'spreadsheet-1',
    userId: 'user-123',
    provider: 'google',
    fileId: 'file-1',
    fileName: 'Gastos',
    sheetName: 'Hoja 1',
    accessVerifiedAt: new Date(),
    categoriesConfirmedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildUserCategory(rawValue: string): UserCategory {
  return {
    id: `category-${rawValue}`,
    spreadsheetId: 'spreadsheet-1',
    rawValue,
    normalizedValue: rawValue
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''),
    usageCount: 0,
    isActive: true,
    createdAt: new Date(),
  };
}

function buildRepository(): DrizzleCategoryKeywordVocabularyRepository {
  const spreadsheetConfigRepo: ISpreadsheetConfigRepository = {
    findByUserId: mockFindByUserId,
    create: vi.fn(),
    upsertByUserId: vi.fn(),
    updateAccessVerified: vi.fn(),
    updateCategoriesConfirmed: vi.fn(),
  };

  const userCategoryRepo: IUserCategoryRepository = {
    findActiveBySpreadsheetId: mockFindActiveBySpreadsheetId,
    upsertMany: vi.fn(),
    incrementUsage: vi.fn(),
  };

  return new DrizzleCategoryKeywordVocabularyRepository(spreadsheetConfigRepo, userCategoryRepo);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DrizzleCategoryKeywordVocabularyRepository', () => {
  it('returns the base vocabulary when the user has no spreadsheet config', async () => {
    mockFindByUserId.mockResolvedValue(null);

    const repository = buildRepository();
    const vocabulary = await repository.findByUserId('user-123');

    expect(mockFindByUserId).toHaveBeenCalledWith('user-123');
    expect(mockFindActiveBySpreadsheetId).not.toHaveBeenCalled();
    expect(vocabulary.getUserCategories()).toEqual([]);
  });

  it('returns the base vocabulary when the spreadsheet has no active categories', async () => {
    mockFindByUserId.mockResolvedValue(buildSpreadsheetConfig());
    mockFindActiveBySpreadsheetId.mockResolvedValue([]);

    const repository = buildRepository();
    const vocabulary = await repository.findByUserId('user-123');

    expect(mockFindActiveBySpreadsheetId).toHaveBeenCalledWith('spreadsheet-1');
    expect(vocabulary.getUserCategories()).toEqual([]);
  });

  it('merges active user categories into the base vocabulary', async () => {
    mockFindByUserId.mockResolvedValue(buildSpreadsheetConfig());
    mockFindActiveBySpreadsheetId.mockResolvedValue([
      buildUserCategory('Comida'),
      buildUserCategory('Transporte'),
    ]);

    const repository = buildRepository();
    const vocabulary = await repository.findByUserId('user-123');

    const userCategories = vocabulary.getUserCategories();
    expect(userCategories).toContain('Comida');
    expect(userCategories).toContain('Transporte');
  });

  it('matches user categories ignoring case and diacritics', async () => {
    mockFindByUserId.mockResolvedValue(buildSpreadsheetConfig());
    mockFindActiveBySpreadsheetId.mockResolvedValue([buildUserCategory('MÉDICO')]);

    const repository = buildRepository();
    const vocabulary = await repository.findByUserId('user-123');

    const matches = vocabulary.findAllMatches('gasto médico');
    expect(matches.totalTokens).toBe(2);
    expect(matches.scores.get('health')).toBe(1);
  });
});
