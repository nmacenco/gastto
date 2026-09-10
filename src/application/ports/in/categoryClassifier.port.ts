// LAYER: Application
// Input port for category classification.
// The Application layer owns this contract; the route handler deserializes
// input and delegates to the implementation use case.

import type { HierarchicalClassificationResult } from '../../../domain/value-objects/ClassificationResult';
import type { CategoryConfidence } from '../../../domain/entities/ExpenseRecord';

export interface ClassifyExpenseCategoryInput {
  readonly userId: string;
  readonly spreadsheetId: string | null;
  readonly rawMessage: string;
  readonly llmCategory: string | null;
  readonly llmConfidence: CategoryConfidence;
  readonly llmSubcategory: string | null;
  readonly llmSubcategoryConfidence: CategoryConfidence;
}

export interface ICategoryClassifier {
  execute(input: ClassifyExpenseCategoryInput): Promise<HierarchicalClassificationResult>;
}
