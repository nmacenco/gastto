// LAYER: Application / Tests
// Contract tests for ICategoryClassifier and ClassifyExpenseCategoryInput.
// Verifies the input port accepts domain value objects and plain primitives.

import { describe, it, expect, vi } from 'vitest';
import type { ICategoryClassifier, ClassifyExpenseCategoryInput } from './categoryClassifier.port';
import { ClassificationResult } from '../../../domain/value-objects/ClassificationResult';

describe('ICategoryClassifier contract', () => {
  it('accepts a valid input and returns a ClassificationResult', async () => {
    const mockExecute = vi.fn().mockResolvedValue(ClassificationResult.highConfidence('Comida'));
    const port: ICategoryClassifier = { execute: mockExecute };

    const input: ClassifyExpenseCategoryInput = {
      userId: 'user-123',
      rawMessage: 'Pagué el almuerzo',
      llmCategory: null,
      llmConfidence: 'nula',
    };

    const result = await port.execute(input);

    expect(mockExecute).toHaveBeenCalledWith(input);
    expect(result.kind).toBe('high-confidence');
    expect(result.category).toBe('Comida');
  });

  it('has the correct method signature', () => {
    const mockExecute = vi.fn().mockResolvedValue(ClassificationResult.noMatch());
    const port: ICategoryClassifier = { execute: mockExecute };

    expect(typeof port.execute).toBe('function');
  });
});
