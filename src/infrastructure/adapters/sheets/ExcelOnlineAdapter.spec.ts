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
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { code: 'forbidden' } }),
      });

      await expect(adapter.listSheets('file-id-123')).rejects.toBeInstanceOf(SpreadsheetError);
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
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: { code: 'itemNotFound' } }),
      });

      await expect(adapter.getHeaders('file-id-123', 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );
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
    it('returns deduplicated non-empty values starting from row 2', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            values: [['Comida'], ['Transporte'], ['Comida'], [''], ['Servicios']],
          }),
      });

      const result = await adapter.getUniqueValues('file-id-123', 2, 'Gastos');

      expect(result).toEqual(['Comida', 'Transporte', 'Servicios']);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/range(address='C2:C1048576')");
    });

    it('returns empty array when response has no values', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const result = await adapter.getUniqueValues('file-id-123', 0, 'Gastos');

      expect(result).toEqual([]);
    });

    it('starts at the supplied data row instead of including a later header row', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values: [['Comida'], ['Transporte']] }),
      });

      const result = await adapter.getUniqueValues('file-id-123', 2, 'Gastos', 3);

      expect(result).toEqual(['Comida', 'Transporte']);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/range(address='C3:C1048576')");
    });

    it.each([0, -1, 2.5])(
      'rejects invalid data start row %s before making a request',
      async (row) => {
        await expect(
          adapter.getUniqueValues('file-id-123', 2, 'Gastos', row),
        ).rejects.toBeInstanceOf(SpreadsheetError);

        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('throws SpreadsheetError on API error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: {} }),
      });

      await expect(adapter.getUniqueValues('file-id-123', 0, 'Gastos')).rejects.toBeInstanceOf(
        SpreadsheetError,
      );
    });
  });

  describe('readRows', () => {
    it('preserves mixed cells, blank offsets, sparse cells, and absolute row indexes', async () => {
      const sparseRow = new Array<unknown>(3);
      sparseRow[0] = 'Casa';
      sparseRow[2] = false;
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            rowIndex: 6,
            values: [
              ['Comida', '', 12.5],
              [true, null, 'EUR'],
              sparseRow,
              ['trailing cells omitted'],
            ],
          }),
      });

      await expect(adapter.readRows('file-id', "'Gastos 2026'!B5:D")).resolves.toEqual([
        { index: 7, values: ['Comida', '', 12.5] },
        { index: 8, values: [true, null, 'EUR'] },
        { index: 9, values: ['Casa', null, false] },
        { index: 10, values: ['trailing cells omitted'] },
      ]);

      expect(fetchMock).toHaveBeenCalledWith(
        "https://graph.microsoft.com/v1.0/me/drive/items/file-id/workbook/worksheets/Gastos%202026/range(address='B5%3AD')",
        { headers: { Authorization: 'Bearer access-token-123' } },
      );
    });

    it('safely encodes worksheet punctuation and the range address', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values: [] }),
      });

      await expect(adapter.readRows('file-id', "'Q1 & O''Brien!'!A2:C10")).resolves.toEqual([]);

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://graph.microsoft.com/v1.0/me/drive/items/file-id/workbook/worksheets/Q1%20%26%20O%27Brien%21/range(address='A2%3AC10')",
      );
    });

    it('uses a valid provider-returned address when rowIndex is absent', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ address: "'Gastos 2026'!A11:C12", values: [['Casa']] }),
      });

      await expect(adapter.readRows('file-id', "'Gastos 2026'!A5:C")).resolves.toEqual([
        { index: 11, values: ['Casa'] },
      ]);
    });

    it('returns an empty array for a valid empty range', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ rowIndex: 3, values: [] }),
      });

      await expect(adapter.readRows('file-id', 'Gastos!A4:C')).resolves.toEqual([]);
    });

    it.each(['range', 'Gastos!A:F', 'Gastos!A0:F', '!A1:F', 'Gastos!A1:'])(
      'rejects invalid range %s before making a request',
      async (range) => {
        await expect(adapter.readRows('file-id', range)).rejects.toMatchObject({
          code: 'STRUCTURE_ERROR',
          retryable: false,
        });
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it.each([
      null,
      { values: {} },
      { rowIndex: -1, values: [] },
      { address: 42, values: [] },
      { values: ['not-a-row'] },
      { values: [[{ formula: '=1+1' }]] },
    ])('classifies malformed payloads as structure errors', async (payload) => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(payload),
      });

      await expect(adapter.readRows('file-id', 'Gastos!A2:C')).rejects.toMatchObject({
        code: 'STRUCTURE_ERROR',
        retryable: false,
      });
    });

    it.each([401, 403])('classifies HTTP %s as an authorization error', async (status) => {
      fetchMock.mockResolvedValue({ ok: false, status });

      await expect(adapter.readRows('file-id', 'Gastos!A2:C')).rejects.toMatchObject({
        code: 'AUTH_ERROR',
        retryable: false,
      });
    });

    it.each([400, 404])('classifies HTTP %s as a structure error', async (status) => {
      fetchMock.mockResolvedValue({ ok: false, status });

      await expect(adapter.readRows('file-id', 'Gastos!A2:C')).rejects.toMatchObject({
        code: 'STRUCTURE_ERROR',
        retryable: false,
      });
    });

    it('classifies provider 5xx responses as retryable network errors', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503 });

      await expect(adapter.readRows('file-id', 'Gastos!A2:C')).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
        retryable: true,
      });
    });

    it('classifies transport failures as retryable network errors', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));

      await expect(adapter.readRows('file-id', 'Gastos!A2:C')).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
        retryable: true,
      });
    });

    it('classifies unexpected HTTP failures as unknown errors', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 429 });

      await expect(adapter.readRows('file-id', 'Gastos!A2:C')).rejects.toMatchObject({
        code: 'UNKNOWN',
        retryable: false,
      });
    });

    it('classifies invalid JSON as a structure error', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('invalid JSON')),
      });

      await expect(adapter.readRows('file-id', 'Gastos!A2:C')).rejects.toMatchObject({
        code: 'STRUCTURE_ERROR',
        retryable: false,
      });
    });
  });

  describe('unimplemented methods', () => {
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
