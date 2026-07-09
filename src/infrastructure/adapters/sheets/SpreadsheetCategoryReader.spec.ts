// LAYER: Infrastructure / Tests
// Unit tests for SpreadsheetCategoryReader.
// Mocks SpreadsheetPort to avoid external API calls.

import { describe, it, expect, vi } from 'vitest';
import { SpreadsheetCategoryReader } from './SpreadsheetCategoryReader';
import type { SpreadsheetPort } from '../../../domain/ports/services';

function buildMockPort(values: string[]): {
  port: SpreadsheetPort;
  getUniqueValues: ReturnType<typeof vi.fn>;
} {
  const getUniqueValues = vi.fn().mockResolvedValue(values);
  return {
    port: { getUniqueValues } as unknown as SpreadsheetPort,
    getUniqueValues,
  };
}

describe('SpreadsheetCategoryReader', () => {
  it('normalizes and deduplicates values from the spreadsheet port', async () => {
    const { port, getUniqueValues } = buildMockPort([
      '  Comida  ',
      'TRANSPORTE',
      'comida',
      'Servicios',
      '',
    ]);
    const reader = new SpreadsheetCategoryReader(port);

    const result = await reader.readCategories('file-123', 2, 'Gastos');

    expect(result).toEqual(['comida', 'transporte', 'servicios']);
    expect(getUniqueValues).toHaveBeenCalledWith('file-123', 2, 'Gastos');
  });

  it('returns empty array when no values are found', async () => {
    const { port } = buildMockPort([]);
    const reader = new SpreadsheetCategoryReader(port);

    const result = await reader.readCategories('file-123', 0, 'Gastos');

    expect(result).toEqual([]);
  });

  it('filters values that become empty after trimming', async () => {
    const { port } = buildMockPort(['   ', 'Comida', '', 'Transporte']);
    const reader = new SpreadsheetCategoryReader(port);

    const result = await reader.readCategories('file-123', 0, 'Gastos');

    expect(result).toEqual(['comida', 'transporte']);
  });
});
