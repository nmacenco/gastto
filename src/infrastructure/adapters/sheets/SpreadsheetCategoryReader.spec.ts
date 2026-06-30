// LAYER: Infrastructure / Tests
// Unit tests for SpreadsheetCategoryReader.
// Mocks SpreadsheetPortFactory so no real spreadsheet calls are made.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpreadsheetCategoryReader } from './SpreadsheetCategoryReader';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import type { SpreadsheetPortFactory, SpreadsheetPort } from '../../../domain/ports/services';
import type { ReadUniqueCategoriesInput } from '../../../domain/ports/categoryVocabulary';
import type { Logger } from 'pino';

describe('SpreadsheetCategoryReader', () => {
  const mockGetUniqueValues = vi.fn();
  const mockLoggerError = vi.fn();

  const mockSpreadsheetPort: SpreadsheetPort = {
    getUniqueValues: mockGetUniqueValues,
  } as unknown as SpreadsheetPort;

  const mockCreatePort = vi.fn().mockReturnValue(mockSpreadsheetPort);

  const mockFactory: SpreadsheetPortFactory = {
    create: mockCreatePort,
  };

  const mockLogger = { error: mockLoggerError } as unknown as Logger;

  let reader: SpreadsheetCategoryReader;

  beforeEach(() => {
    vi.clearAllMocks();
    reader = new SpreadsheetCategoryReader(mockFactory, mockLogger);
  });

  const baseInput: ReadUniqueCategoriesInput = {
    provider: 'google',
    fileId: 'spreadsheet-123',
    sheetName: 'Gastos',
    accessToken: 'token',
    columnIndex: 2,
  };

  it('creates a provider-specific port and reads unique values', async () => {
    mockGetUniqueValues.mockResolvedValue(['Food', 'Transportation', 'Health']);

    const result = await reader.readUniqueCategories(baseInput);

    expect(mockCreatePort).toHaveBeenCalledWith('google', 'token');
    expect(mockGetUniqueValues).toHaveBeenCalledWith('spreadsheet-123', 2, 'Gastos');
    expect(result).toEqual(['Food', 'Health', 'Transportation']);
  });

  it('normalizes whitespace and deduplicates case-insensitively', async () => {
    mockGetUniqueValues.mockResolvedValue([
      '  Food  ',
      '  food  ',
      'Transportation',
      '  TRANSPORTATION  ',
      'Health',
    ]);

    const result = await reader.readUniqueCategories(baseInput);

    expect(result).toEqual(['Food', 'Health', 'Transportation']);
  });

  it('filters empty values', async () => {
    mockGetUniqueValues.mockResolvedValue(['Food', '', '   ', 'Health', '']);

    const result = await reader.readUniqueCategories(baseInput);

    expect(result).toEqual(['Food', 'Health']);
  });

  it('returns empty array when column has no values', async () => {
    mockGetUniqueValues.mockResolvedValue([]);

    const result = await reader.readUniqueCategories(baseInput);

    expect(result).toEqual([]);
  });

  it('supports Microsoft provider', async () => {
    mockGetUniqueValues.mockResolvedValue(['Food', 'Transportation']);

    const result = await reader.readUniqueCategories({
      ...baseInput,
      provider: 'microsoft',
      accessToken: 'ms-token',
    });

    expect(mockCreatePort).toHaveBeenCalledWith('microsoft', 'ms-token');
    expect(result).toEqual(['Food', 'Transportation']);
  });

  it('logs and rethrows SpreadsheetError from the port', async () => {
    const error = new SpreadsheetError('permission denied');
    mockGetUniqueValues.mockRejectedValue(error);

    await expect(reader.readUniqueCategories(baseInput)).rejects.toBe(error);

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'SpreadsheetCategoryReader.readUniqueCategories',
        code: 'UNIQUE_VALUES_READ_ERROR',
        provider: 'google',
        fileId: 'spreadsheet-123',
        sheetName: 'Gastos',
        columnIndex: 2,
        error: 'permission denied',
      }),
    );
  });

  it('logs and wraps non-SpreadsheetError exceptions', async () => {
    mockGetUniqueValues.mockRejectedValue(new Error('network timeout'));

    await expect(reader.readUniqueCategories(baseInput)).rejects.toBeInstanceOf(SpreadsheetError);

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'SpreadsheetCategoryReader.readUniqueCategories',
        code: 'UNIQUE_VALUES_READ_ERROR',
      }),
    );
  });
});
