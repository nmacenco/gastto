// LAYER: Application
// Output port for finding the closest available user category when the
// inferred canonical category is not present in the user's spreadsheet.

import type { CanonicalCategory } from '../../../domain/value-objects/CategoryKeywordVocabulary';

export interface ICategoryFallbackMapper {
  findClosest(
    inferred: CanonicalCategory,
    available: readonly string[],
  ): Promise<string | null>;
}
