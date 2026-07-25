// LAYER: Application
// Output port for retrieving the keyword vocabulary of a user's spreadsheet.
// The Application layer owns this contract; Infrastructure adapters decide
// how to build the vocabulary from the existing category repositories.

import type { CategoryKeywordVocabulary } from '../../../domain/value-objects/CategoryKeywordVocabulary';

export interface ICategoryKeywordVocabularyRepository {
  findByUserId(userId: string): Promise<CategoryKeywordVocabulary>;
}
