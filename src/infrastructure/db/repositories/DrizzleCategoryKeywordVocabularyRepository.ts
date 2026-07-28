// LAYER: Infrastructure
// Concrete implementation of ICategoryKeywordVocabularyRepository.
// Builds the keyword vocabulary from the persisted user categories, falling
// back to the base vocabulary when no spreadsheet config or categories exist.

import type { ICategoryKeywordVocabularyRepository } from '../../../application/ports/output/categoryKeywordVocabularyRepository.port';
import { CategoryKeywordVocabulary } from '../../../domain/value-objects/CategoryKeywordVocabulary';
import type {
  ISpreadsheetConfigRepository,
  IUserCategoryRepository,
} from '../../../domain/ports/repositories';

export class DrizzleCategoryKeywordVocabularyRepository implements ICategoryKeywordVocabularyRepository {
  constructor(
    private readonly spreadsheetConfigRepo: ISpreadsheetConfigRepository,
    private readonly userCategoryRepo: IUserCategoryRepository,
  ) {}

  async findByUserId(userId: string): Promise<CategoryKeywordVocabulary> {
    const config = await this.spreadsheetConfigRepo.findByUserId(userId);
    if (!config) {
      return CategoryKeywordVocabulary.createBase();
    }

    const categories = await this.userCategoryRepo.findActiveBySpreadsheetId(config.id);
    const categoryNames = categories.map((category) => category.rawValue);

    if (categoryNames.length === 0) {
      return CategoryKeywordVocabulary.createBase();
    }

    return CategoryKeywordVocabulary.createBase().withUserCategories(categoryNames);
  }
}
