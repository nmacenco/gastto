// LAYER: Domain
// Output ports required by the category-vocabulary confirmation flow.
// These interfaces are implemented by infrastructure adapters (spreadsheet
// reader, Redis-backed repository, onboarding completion handler) and keep the
// Application layer free of provider-specific details.

import type { SpreadsheetProvider } from '../entities/SpreadsheetConfig';
import type { CategoryVocabulary } from '../value-objects/CategoryVocabulary';

export interface ReadUniqueCategoriesInput {
  provider: SpreadsheetProvider;
  fileId: string;
  sheetName: string;
  accessToken: string;
  columnIndex: number;
}

export interface CategoryReaderPort {
  readUniqueCategories(input: ReadUniqueCategoriesInput): Promise<string[]>;
}

export interface CategoryVocabularyRepositoryPort {
  save(userId: string, vocabulary: CategoryVocabulary, ttlSeconds: number): Promise<void>;
  load(userId: string): Promise<CategoryVocabulary | null>;
}

export interface OnboardingCompletionPort {
  complete(userId: string): Promise<void>;
}
