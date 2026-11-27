import { describe, expect, it } from 'vitest';
import { buildExtractionSystemPrompt } from './expenseExtraction';

describe('buildExtractionSystemPrompt', () => {
  it('requests calendar dates without hiding invalid explicit dates as missing', () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toContain('YYYY-MM-DD');
    expect(prompt).toContain('sin convertirlo a UTC');
    expect(prompt).toContain('Si no hay fecha, devolver null');
    expect(prompt).toContain('conservar ese texto para su validación');
    expect(prompt).toContain('"fecha_raw": string | null');
  });

  it('asks providers to infer configured categories from the expense concept or merchant', () => {
    const prompt = buildExtractionSystemPrompt();

    expect(prompt).toContain('concepto o comercio');
    expect(prompt).toContain('aunque el usuario no nombre esos campos explícitamente');
    expect(prompt).toContain('exclusivamente nombres presentes en categories/categoryHierarchy');
    expect(prompt).toContain('conservar su texto explícito');
    expect(prompt).toContain('no adivinar una tarjeta concreta');
  });
});
