// LAYER: Infrastructure / Tests
// Contract tests for GoogleSheetsAdapter.
// Mocks the global fetch API so no real Google calls are made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleSheetsAdapter } from './GoogleSheetsAdapter';
import { SheetInfo } from '../../../domain/entities/SheetInfo';
import { SpreadsheetPreview } from '../../../domain/entities/SpreadsheetPreview';
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

  describe('getUniqueValues', () => {
    it('returns deduplicated non-empty values starting from row 2', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            values: [['Comida'], ['Transporte'], ['Comida'], [''], ['Servicios']],
          }),
      });

      const result = await adapter.getUniqueValues('spreadsheet-123', 2, 'Gastos');

      expect(result).toEqual(['Comida', 'Transporte', 'Servicios']);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://sheets.googleapis.com/v4/spreadsheets/spreadsheet-123/values/Gastos!C2:C',
      );
    });

    it('returns empty array when response has no values', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const result = await adapter.getUniqueValues('spreadsheet-123', 0, 'Gastos');

      expect(result).toEqual([]);
    });

    it('throws SpreadsheetError on API error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: {} }),
      });

      await expect(adapter.getUniqueValues('spreadsheet-123', 0, 'Gastos')).rejects.toBeInstanceOf(
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

    it('validateAccess throws SpreadsheetError', async () => {
      await expect(adapter.validateAccess('id', 'sheet')).rejects.toBeInstanceOf(SpreadsheetError);
    });
  });

  describe('validateSpreadsheetAccess', () => {
    const fileId = 'spreadsheet-123';
    const sheetName = 'Gastos';

    it('returns success when read and write permissions are confirmed', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              values: [
                ['Fecha', 'Concepto', 'Monto'],
                ['2024-01-01', 'Lunch', '15.50'],
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ capabilities: { canEdit: true } }),
        });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('success');
      if (result.kind === 'success') {
        expect(result.preview).toBeInstanceOf(SpreadsheetPreview);
        expect(result.preview.provider).toBe('google');
        expect(result.preview.fileId).toBe(fileId);
        expect(result.preview.sheetName).toBe(sheetName);
        expect(result.preview.rows).toHaveLength(2);
      }

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [sheetsUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(sheetsUrl).toContain('/values/Gastos!1:20');
      const [driveUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(driveUrl).toContain('/files/spreadsheet-123?fields=capabilities(canEdit)');
    });

    it('returns read-only when write permission is denied', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              values: [['Fecha', 'Concepto']],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ capabilities: { canEdit: false } }),
        });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('read-only');
      if (result.kind === 'read-only') {
        expect(result.preview).toBeInstanceOf(SpreadsheetPreview);
      }
    });

    it('returns empty-sheet when sheet has no content', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('empty-sheet');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns empty-sheet when values array is empty', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values: [] }),
      });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('empty-sheet');
    });

    it('returns access-error with network-error on fetch failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('network-error');
        expect(result.retryable).toBe(true);
      }
    });

    it('returns access-error with token-expired on 401 from Sheets API', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'invalid_token' }),
      });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('token-expired');
        expect(result.retryable).toBe(true);
      }
    });

    it('returns access-error with permission-denied on 403 from Sheets API', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: 'forbidden' }),
      });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('permission-denied');
        expect(result.retryable).toBe(true);
      }
    });

    it('returns access-error with unknown on other HTTP errors from Sheets API', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'internal' }),
      });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('unknown');
        expect(result.retryable).toBe(true);
      }
      consoleErrorSpy.mockRestore();
    });

    it('returns access-error with network-error on fetch failure during capability check', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              values: [['Fecha']],
            }),
        })
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('network-error');
        expect(result.retryable).toBe(true);
      }
    });

    it('returns access-error with token-expired on 401 from Drive API', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              values: [['Fecha']],
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'invalid_token' }),
        });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('token-expired');
        expect(result.retryable).toBe(true);
      }
    });

    it('returns access-error with permission-denied on 403 from Drive API', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              values: [['Fecha']],
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ error: 'forbidden' }),
        });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('permission-denied');
        expect(result.retryable).toBe(true);
      }
    });

    it('returns access-error with unknown on other HTTP errors from Drive API', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              values: [['Fecha']],
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'internal' }),
        });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('unknown');
        expect(result.retryable).toBe(true);
      }
      consoleErrorSpy.mockRestore();
    });

    it('returns read-only when capabilities.canEdit is missing', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              values: [['Fecha']],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('read-only');
    });

    it('encodes sheet name with special characters', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              values: [['Fecha']],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ capabilities: { canEdit: true } }),
        });

      await adapter.validateSpreadsheetAccess(fileId, 'My Sheet!');

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(encodeURIComponent('My Sheet!'));
    });
  });
});
