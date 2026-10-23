// LAYER: Infrastructure / Tests
// Integration-style factory tests with mocked provider HTTP boundaries.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExcelOnlineAdapterFactory } from './ExcelOnlineAdapterFactory';
import { GoogleSheetsAdapterFactory } from './GoogleSheetsAdapterFactory';
import { SpreadsheetCategoryHierarchyReaderFactory } from './SpreadsheetCategoryHierarchyReaderFactory';

describe('SpreadsheetCategoryHierarchyReaderFactory', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a Google-backed reader that delegates to Google readRows', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ values: [['Food', 'Cafe']] }),
    });
    const reader = new SpreadsheetCategoryHierarchyReaderFactory(
      new GoogleSheetsAdapterFactory(),
    ).create('google-token');

    await expect(reader.readHierarchy('google-file', 0, 1, 'Gastos')).resolves.toEqual({
      categories: ['food'],
      pairs: [{ category: 'food', subcategory: 'cafe' }],
      orphanSubcategories: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sheets.googleapis.com/v4/spreadsheets/google-file/values/%27Gastos%27%21A2%3AB',
      { headers: { Authorization: 'Bearer google-token' } },
    );
  });

  it('creates a Microsoft-backed reader that delegates to Excel readRows', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ rowIndex: 1, values: [['Food', 'Cafe']] }),
    });
    const reader = new SpreadsheetCategoryHierarchyReaderFactory(
      new ExcelOnlineAdapterFactory(),
    ).create('microsoft-token');

    await expect(reader.readHierarchy('microsoft-file', 0, 1, 'Gastos')).resolves.toEqual({
      categories: ['food'],
      pairs: [{ category: 'food', subcategory: 'cafe' }],
      orphanSubcategories: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/me/drive/items/microsoft-file/workbook/worksheets/Gastos/range(address='A2%3AB')",
      { headers: { Authorization: 'Bearer microsoft-token' } },
    );
  });
});
