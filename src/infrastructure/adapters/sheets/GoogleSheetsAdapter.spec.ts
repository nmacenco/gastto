// LAYER: Infrastructure / Tests
// Contract tests for GoogleSheetsAdapter.
// Mocks the global fetch API so no real Google calls are made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleSheetsAdapter } from './GoogleSheetsAdapter';
import { SheetInfo } from '../../../domain/entities/SheetInfo';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

describe('GoogleSheetsAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let adapter: GoogleSheetsAdapter;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    adapter = new GoogleSheetsAdapter('access-token-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listSheets', () => {
    it('returns SheetInfo array on successful response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sheets: [
              {
                properties: {
                  title: 'Gastos',
                  index: 0,
                },
              },
              {
                properties: {
                  title: 'Ingresos',
                  index: 1,
                },
              },
            ],
          }),
      });

      const result = await adapter.listSheets('spreadsheet-123');

      expect(result).toHaveLength(2);
      const first = result[0];
      if (!first) throw new Error('Expected first to be defined');
      expect(first).toBeInstanceOf(SheetInfo);
      expect(first.name).toBe('Gastos');
      expect(first.index).toBe(0);

      const second = result[1];
      if (!second) throw new Error('Expected second to be defined');
      expect(second.name).toBe('Ingresos');
      expect(second.index).toBe(1);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://sheets.googleapis.com/v4/spreadsheets/spreadsheet-123?fields=sheets.properties(title,index)',
      );
      expect(init.headers).toEqual({ Authorization: 'Bearer access-token-123' });
    });

    it('returns empty array when spreadsheet has no sheets', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ sheets: [] }),
      });

      const result = await adapter.listSheets('spreadsheet-123');
      expect(result).toEqual([]);
    });

    it('throws SpreadsheetError on non-2xx HTTP', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: 'forbidden' }),
      });

      await expect(adapter.listSheets('spreadsheet-123')).rejects.toBeInstanceOf(SpreadsheetError);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'GoogleSheetsAdapter.listSheets',
          code: 'SHEETS_API_ERROR',
          status: 403,
          errorBody: { error: 'forbidden' },
        }),
      );
      consoleErrorSpy.mockRestore();
    });

    it('throws SpreadsheetError on invalid JSON response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      await expect(adapter.listSheets('spreadsheet-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('throws SpreadsheetError on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(adapter.listSheets('spreadsheet-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('throws SpreadsheetError on unexpected response format', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ unknownField: 'value' }),
      });

      await expect(adapter.listSheets('spreadsheet-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('throws SpreadsheetError when sheet item is null', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sheets: [null],
          }),
      });

      await expect(adapter.listSheets('spreadsheet-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('throws SpreadsheetError when sheet item lacks properties', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sheets: [{ otherField: 'value' }],
          }),
      });

      await expect(adapter.listSheets('spreadsheet-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('throws SpreadsheetError when sheet title is empty', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sheets: [
              {
                properties: {
                  title: '',
                  index: 0,
                },
              },
            ],
          }),
      });

      await expect(adapter.listSheets('spreadsheet-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('throws SpreadsheetError when error body parsing fails on non-2xx', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      await expect(adapter.listSheets('spreadsheet-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });
  });

  describe('getHeaders', () => {
    it('returns string array on successful response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            range: 'Gastos!A1:F1',
            majorDimension: 'ROWS',
            values: [['Fecha', 'Concepto', 'Monto', 'Moneda', 'Categoria', 'Medio de Pago']],
          }),
      });

      const result = await adapter.getHeaders('spreadsheet-123', 'Gastos');

      expect(result).toEqual([
        'Fecha',
        'Concepto',
        'Monto',
        'Moneda',
        'Categoria',
        'Medio de Pago',
      ]);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://sheets.googleapis.com/v4/spreadsheets/spreadsheet-123/values/Gastos!1:1',
      );
      expect(init.headers).toEqual({ Authorization: 'Bearer access-token-123' });
    });

    it('returns empty array when sheet has no values', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const result = await adapter.getHeaders('spreadsheet-123', 'Gastos');
      expect(result).toEqual([]);
    });

    it('returns empty array when values array is empty', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values: [] }),
      });

      const result = await adapter.getHeaders('spreadsheet-123', 'Gastos');
      expect(result).toEqual([]);
    });

    it('encodes sheet name with special characters', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values: [['Header']] }),
      });

      await adapter.getHeaders('spreadsheet-123', 'My Sheet!');

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(encodeURIComponent('My Sheet!'));
    });

    it('throws SpreadsheetError on non-2xx HTTP', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'notFound' }),
      });

      await expect(adapter.getHeaders('spreadsheet-123', 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'GoogleSheetsAdapter.getHeaders',
          code: 'SHEETS_API_ERROR',
          status: 404,
          errorBody: { error: 'notFound' },
        }),
      );
      consoleErrorSpy.mockRestore();
    });

    it('throws SpreadsheetError on invalid JSON response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      await expect(adapter.getHeaders('spreadsheet-123', 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );
    });

    it('throws SpreadsheetError on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(adapter.getHeaders('spreadsheet-123', 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );
    });

    it('throws SpreadsheetError when first row is not an array', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values: ['not-an-array'] }),
      });

      await expect(adapter.getHeaders('spreadsheet-123', 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );
    });

    it('converts mixed-type cell values to strings', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            values: [['Fecha', 123, null, true]],
          }),
      });

      const result = await adapter.getHeaders('spreadsheet-123', 'Gastos');
      expect(result).toEqual(['Fecha', '123', 'null', 'true']);
    });

    it('throws SpreadsheetError when error body parsing fails on non-2xx', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      await expect(adapter.getHeaders('spreadsheet-123', 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );
    });
  });

  describe('unimplemented methods', () => {
    it('readRows throws SpreadsheetError', async () => {
      await expect(adapter.readRows('id', 'range')).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('appendRow throws SpreadsheetError', async () => {
      await expect(adapter.appendRow('id', 'sheet', [])).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('deleteRow throws SpreadsheetError', async () => {
      await expect(adapter.deleteRow('id', 'sheet', 1)).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('getUniqueValues throws SpreadsheetError', async () => {
      await expect(adapter.getUniqueValues('id', 0, 'sheet')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );
    });

    it('validateAccess throws SpreadsheetError', async () => {
      await expect(adapter.validateAccess('id', 'sheet')).rejects.toBeInstanceOf(SpreadsheetError);
    });
  });
});
