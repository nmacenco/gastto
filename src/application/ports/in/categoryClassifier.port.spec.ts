// LAYER: Application / Tests

import { describe, expect, it, vi } from 'vitest';
import type { ICategoryClassifier, ClassifyExpenseCategoryInput } from './categoryClassifier.port';
import { HierarchicalClassificationResult } from '../../../domain/value-objects/ClassificationResult';

describe('ICategoryClassifier contract', () => {
  it('accepts hierarchy inputs and returns a stable hierarchical result', async () => {
    const execute = vi.fn().mockResolvedValue(HierarchicalClassificationResult.none());
    const port: ICategoryClassifier = { execute };
    const input: ClassifyExpenseCategoryInput = {
      userId: 'user-123',
      spreadsheetId: 'spreadsheet-123',
      rawMessage: 'Pagué el almuerzo',
      llmCategory: null,
      llmConfidence: 'nula',
      llmSubcategory: null,
      llmSubcategoryConfidence: 'nula',
    };

    const result = await port.execute(input);

    expect(execute).toHaveBeenCalledWith(input);
    expect(result.category.status).toBe('none');
    expect(result.subcategory.categoryId).toBeNull();
  });
});
