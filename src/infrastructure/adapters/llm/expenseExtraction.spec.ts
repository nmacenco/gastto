import { describe, expect, it } from 'vitest';
import { buildExtractionSystemPrompt } from './expenseExtraction';

describe('buildExtractionSystemPrompt', () => {
  it('asks providers to infer configured categories from the expense concept or merchant', () => {
    const prompt = buildExtractionSystemPrompt();

    expect(prompt).toContain('concepto o comercio');
    expect(prompt).toContain('aunque el usuario no nombre esos campos explícitamente');
    expect(prompt).toContain('exclusivamente nombres presentes en categories/categoryHierarchy');
  });
});
