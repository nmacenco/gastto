// LAYER: Infrastructure / Tests
// Contract tests for ExcelOnlineAdapter.
// Mocks the global fetch API so no real Microsoft Graph calls are made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExcelOnlineAdapter } from './ExcelOnlineAdapter';
import { SheetInfo } from '../../../domain/entities/SheetInfo';
import { SpreadsheetPreview } from '../../../domain/entities/SpreadsheetPreview';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

describe('ExcelOnlineAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let adapter: ExcelOnlineAdapter;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    adapter = new ExcelOnlineAdapter('access-token-123');
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
            value: [
              { name: 'Gastos', position: 0 },
              { name: 'Ingresos', position: 1 },
            ],
          }),
      });

      const result = await adapter.listSheets('file-id-123');

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
        'https://graph.microsoft.com/v1.0/me/drive/items/file-id-123/workbook/worksheets',
      );
      expect(init.headers).toEqual({ Authorization: 'Bearer access-token-123' });
    });

    it('returns empty array when workbook has no sheets', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });

      const result = await adapter.listSheets('file-id-123');
      expect(result).toEqual([]);
    });

    it('throws SpreadsheetError on non-2xx HTTP', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { code: 'forbidden' } }),
      });

      await expect(adapter.listSheets('file-id-123')).rejects.toBeInstanceOf(SpreadsheetError);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'ExcelOnlineAdapter.listSheets',
          code: 'GRAPH_API_ERROR',
          status: 403,
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

      await expect(adapter.listSheets('file-id-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('throws SpreadsheetError on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(adapter.listSheets('file-id-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('throws SpreadsheetError on unexpected response format', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ unknownField: 'value' }),
      });

      await expect(adapter.listSheets('file-id-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('throws SpreadsheetError when sheet item is null', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [null] }),
      });

      await expect(adapter.listSheets('file-id-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });

    it('throws SpreadsheetError when sheet name is empty', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [{ name: '', position: 0 }] }),
      });

      await expect(adapter.listSheets('file-id-123')).rejects.toBeInstanceOf(SpreadsheetError);
    });
  });

  describe('getHeaders', () => {
    it('returns string array on successful response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            values: [['Fecha', 'Concepto', 'Monto', 'Moneda', 'Categoria', 'Medio de Pago']],
          }),
      });

      const result = await adapter.getHeaders('file-id-123', 'Gastos');

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
        "https://graph.microsoft.com/v1.0/me/drive/items/file-id-123/workbook/worksheets/Gastos/range(address='1:1')",
      );
      expect(init.headers).toEqual({ Authorization: 'Bearer access-token-123' });
    });

    it('returns empty array when sheet has no values', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const result = await adapter.getHeaders('file-id-123', 'Gastos');
      expect(result).toEqual([]);
    });

    it('returns empty array when values array is empty', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values: [] }),
      });

      const result = await adapter.getHeaders('file-id-123', 'Gastos');
      expect(result).toEqual([]);
    });

    it('encodes sheet name with special characters', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values: [['Header']] }),
      });

      await adapter.getHeaders('file-id-123', 'My Sheet!');

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(encodeURIComponent('My Sheet!'));
    });

    it('throws SpreadsheetError on non-2xx HTTP', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: { code: 'itemNotFound' } }),
      });

      await expect(adapter.getHeaders('file-id-123', 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'ExcelOnlineAdapter.getHeaders',
          code: 'GRAPH_API_ERROR',
          status: 404,
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

      await expect(adapter.getHeaders('file-id-123', 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );
    });

    it('throws SpreadsheetError on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(adapter.getHeaders('file-id-123', 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );
    });

    it('throws SpreadsheetError when first row is not an array', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values: ['not-an-array'] }),
      });

      await expect(adapter.getHeaders('file-id-123', 'Gastos')).rejects.toBeInstanceOf(
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

      const result = await adapter.getHeaders('file-id-123', 'Gastos');
      expect(result).toEqual(['Fecha', '123', 'null', 'true']);
    });
  });

  describe('getUniqueValues', () => {
    it('returns unique values from a column', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            values: [['Categoria'], ['Food'], ['Transportation'], ['Food'], ['Health'], ['']],
          }),
      });

      const result = await adapter.getUniqueValues('file-id-123', 2, 'Gastos');

      expect(result).toEqual(['Categoria', 'Food', 'Transportation', 'Food', 'Health', '']);

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://graph.microsoft.com/v1.0/me/drive/items/file-id-123/workbook/worksheets/Gastos/range(address='C:C')",
      );
    });

    it('returns empty array when column has no values', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const result = await adapter.getUniqueValues('file-id-123', 0, 'Gastos');
      expect(result).toEqual([]);
    });

    it('handles multi-letter column indices', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values: [['Value']] }),
      });

      await adapter.getUniqueValues('file-id-123', 27, 'Gastos');

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("address='AB:AB'");
    });

    it('throws SpreadsheetError on non-2xx HTTP', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: { code: 'itemNotFound' } }),
      });

      await expect(adapter.getUniqueValues('file-id-123', 0, 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'ExcelOnlineAdapter.getUniqueValues',
          code: 'GRAPH_API_ERROR',
          status: 404,
        }),
      );
      consoleErrorSpy.mockRestore();
    });

    it('throws SpreadsheetError on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(adapter.getUniqueValues('file-id-123', 0, 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );
    });

    it('throws SpreadsheetError for negative column index', async () => {
      await expect(adapter.getUniqueValues('file-id-123', -1, 'Gastos')).rejects.toBeInstanceOf(
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
    const fileId = 'file-id-123';
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
        expect(result.preview.provider).toBe('microsoft');
        expect(result.preview.fileId).toBe(fileId);
        expect(result.preview.sheetName).toBe(sheetName);
        expect(result.preview.rows).toHaveLength(2);
      }

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [sheetsUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(sheetsUrl).toContain("/range(address='A1:J10')");
      const [driveUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(driveUrl).toContain('/me/drive/items/file-id-123?$select=capabilities');
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

    it('returns access-error with token-expired on 401 from Graph API', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { code: 'unauthenticated' } }),
      });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('token-expired');
        expect(result.retryable).toBe(true);
      }
    });

    it('returns access-error with permission-denied on 403 from Graph API', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { code: 'forbidden' } }),
      });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('permission-denied');
        expect(result.retryable).toBe(true);
      }
    });

    it('returns access-error with unknown on other HTTP errors from Graph API', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { code: 'internalError' } }),
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

    it('returns access-error with token-expired on 401 from capability check', async () => {
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
          json: () => Promise.resolve({ error: { code: 'unauthenticated' } }),
        });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('token-expired');
        expect(result.retryable).toBe(true);
      }
    });

    it('returns access-error with permission-denied on 403 from capability check', async () => {
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
          json: () => Promise.resolve({ error: { code: 'forbidden' } }),
        });

      const result = await adapter.validateSpreadsheetAccess(fileId, sheetName);

      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('permission-denied');
        expect(result.retryable).toBe(true);
      }
    });

    it('returns access-error with unknown on other HTTP errors from capability check', async () => {
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
          json: () => Promise.resolve({ error: { code: 'internalError' } }),
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
