// LAYER: Infrastructure / Tests
// Unit tests for row-preserving category hierarchy detection.

import { describe, expect, it, vi } from 'vitest';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import type { Row, SpreadsheetPort } from '../../../domain/ports/services';
import { SpreadsheetCategoryHierarchyReader } from './SpreadsheetCategoryHierarchyReader';

function buildMockPort(rows: Row[]): {
  port: SpreadsheetPort;
  readRows: ReturnType<typeof vi.fn>;
} {
  const readRows = vi.fn().mockResolvedValue(rows);
  return { port: { readRows } as unknown as SpreadsheetPort, readRows };
}

describe('SpreadsheetCategoryHierarchyReader', () => {
  it('normalizes and deduplicates row-linked pairs while reporting orphans', async () => {
    const { port, readRows } = buildMockPort([
      { index: 2, values: [' Food ', null, ' Supermarket '] },
      { index: 3, values: ['food', null, ' restaurant '] },
      { index: 4, values: [' Leisure ', null, 'RESTAURANT'] },
      { index: 5, values: [' FOOD ', null, 'restaurant'] },
      { index: 6, values: ['Transport', null, ' '] },
      { index: 7, values: [null, null, ' Streaming '] },
      { index: 8, values: ['', null, 'streaming'] },
      { index: 9, values: ['', null, ''] },
      { index: 10, values: ['Utilities'] },
    ]);
    const reader = new SpreadsheetCategoryHierarchyReader(port);

    await expect(reader.readHierarchy('file-123', 0, 2, 'Gastos')).resolves.toEqual({
      categories: ['food', 'leisure', 'transport', 'utilities'],
      pairs: [
        { category: 'food', subcategory: 'supermarket' },
        { category: 'food', subcategory: 'restaurant' },
        { category: 'leisure', subcategory: 'restaurant' },
      ],
      orphanSubcategories: ['streaming'],
    });
    expect(readRows).toHaveBeenCalledWith('file-123', "'Gastos'!A2:C");
  });

  it('supports a subcategory column before its category column', async () => {
    const { port, readRows } = buildMockPort([{ index: 2, values: [' Child ', null, ' Parent '] }]);
    const reader = new SpreadsheetCategoryHierarchyReader(port);

    await expect(reader.readHierarchy('file-123', 2, 0, 'Gastos')).resolves.toEqual({
      categories: ['parent'],
      pairs: [{ category: 'parent', subcategory: 'child' }],
      orphanSubcategories: [],
    });
    expect(readRows).toHaveBeenCalledWith('file-123', "'Gastos'!A2:C");
  });

  it('builds the range through the furthest column from a custom start row', async () => {
    const { port, readRows } = buildMockPort([]);
    const reader = new SpreadsheetCategoryHierarchyReader(port);

    await expect(reader.readHierarchy('file-123', 1, 3, "Gastos 'Q1'", 5)).resolves.toEqual({
      categories: [],
      pairs: [],
      orphanSubcategories: [],
    });
    expect(readRows).toHaveBeenCalledWith('file-123', "'Gastos ''Q1'''!A5:D");
  });

  it.each([
    { categoryColumnIndex: -1, subcategoryColumnIndex: 1, dataStartRow: 2 },
    { categoryColumnIndex: 0.5, subcategoryColumnIndex: 1, dataStartRow: 2 },
    { categoryColumnIndex: 0, subcategoryColumnIndex: -1, dataStartRow: 2 },
    { categoryColumnIndex: 0, subcategoryColumnIndex: 1.5, dataStartRow: 2 },
    { categoryColumnIndex: 0, subcategoryColumnIndex: 1, dataStartRow: 0 },
    { categoryColumnIndex: 0, subcategoryColumnIndex: 1, dataStartRow: 2.5 },
  ])('rejects invalid indexes or start rows before reading', async (input) => {
    const { port, readRows } = buildMockPort([]);
    const reader = new SpreadsheetCategoryHierarchyReader(port);

    await expect(
      reader.readHierarchy(
        'file-123',
        input.categoryColumnIndex,
        input.subcategoryColumnIndex,
        'Gastos',
        input.dataStartRow,
      ),
    ).rejects.toMatchObject({ code: 'STRUCTURE_ERROR', retryable: false });
    expect(readRows).not.toHaveBeenCalled();
  });

  it('returns empty collections when no rows exist', async () => {
    const { port } = buildMockPort([]);
    const reader = new SpreadsheetCategoryHierarchyReader(port);

    await expect(reader.readHierarchy('file-123', 0, 1, 'Gastos')).resolves.toEqual({
      categories: [],
      pairs: [],
      orphanSubcategories: [],
    });
  });

  it('propagates provider failures without returning a partial hierarchy', async () => {
    const providerError = new SpreadsheetError('Provider unavailable', {
      code: 'NETWORK_ERROR',
      retryable: true,
    });
    const readRows = vi.fn().mockRejectedValue(providerError);
    const port = { readRows } as unknown as SpreadsheetPort;
    const reader = new SpreadsheetCategoryHierarchyReader(port);

    await expect(reader.readHierarchy('file-123', 0, 1, 'Gastos')).rejects.toBe(providerError);
  });
});
