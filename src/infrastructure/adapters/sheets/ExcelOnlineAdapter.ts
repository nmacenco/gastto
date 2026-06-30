// LAYER: Infrastructure
// Excel Online adapter. Uses direct fetch calls to Microsoft Graph API.
// Does not depend on @microsoft/microsoft-graph-client SDK to keep the dependency surface minimal.

import type { SpreadsheetPort, Row, AppendResult, CellValue } from '../../../domain/ports/services';
import type { ValidateSpreadsheetAccessPort } from '../../../domain/ports/spreadsheetAccess';
import type { SpreadsheetAccessResult } from '../../../domain/value-objects/SpreadsheetAccessResult';
import { SheetInfo } from '../../../domain/entities/SheetInfo';
import { SpreadsheetPreview } from '../../../domain/entities/SpreadsheetPreview';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

const GRAPH_API_URL = 'https://graph.microsoft.com/v1.0';

export class ExcelOnlineAdapter implements SpreadsheetPort, ValidateSpreadsheetAccessPort {
  constructor(private readonly accessToken: string) {}

  async listSheets(fileId: string): Promise<SheetInfo[]> {
    const url = `${GRAPH_API_URL}/me/drive/items/${fileId}/workbook/worksheets`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
    } catch (err) {
      throw new SpreadsheetError(`Network error during sheet listing: ${String(err)}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new SpreadsheetError(`Invalid JSON response from Graph API: HTTP ${response.status}`);
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = 'Could not parse error body';
      }
      console.error({
        endpoint: 'ExcelOnlineAdapter.listSheets',
        code: 'GRAPH_API_ERROR',
        status: response.status,
        errorBody,
      });
      throw new SpreadsheetError(`Graph API error during sheet listing: HTTP ${response.status}`);
    }

    return parseListSheetsResponse(data);
  }

  async getHeaders(fileId: string, sheetName: string): Promise<string[]> {
    const encodedSheetName = encodeURIComponent(sheetName);
    const url = `${GRAPH_API_URL}/me/drive/items/${fileId}/workbook/worksheets/${encodedSheetName}/range(address='1:1')`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
    } catch (err) {
      throw new SpreadsheetError(`Network error during header retrieval: ${String(err)}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new SpreadsheetError(`Invalid JSON response from Graph API: HTTP ${response.status}`);
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = 'Could not parse error body';
      }
      console.error({
        endpoint: 'ExcelOnlineAdapter.getHeaders',
        code: 'GRAPH_API_ERROR',
        status: response.status,
        errorBody,
      });
      throw new SpreadsheetError(
        `Graph API error during header retrieval: HTTP ${response.status}`,
      );
    }

    return parseGetHeadersResponse(data);
  }

  readRows(_fileId: string, _range: string): Promise<Row[]> {
    return Promise.reject(new SpreadsheetError('readRows not yet implemented'));
  }

  appendRow(_fileId: string, _sheetName: string, _values: CellValue[]): Promise<AppendResult> {
    return Promise.reject(new SpreadsheetError('appendRow not yet implemented'));
  }

  deleteRow(_fileId: string, _sheetName: string, _rowIndex: number): Promise<void> {
    return Promise.reject(new SpreadsheetError('deleteRow not yet implemented'));
  }

  async getUniqueValues(fileId: string, columnIndex: number, sheetName: string): Promise<string[]> {
    const encodedSheetName = encodeURIComponent(sheetName);
    const columnLetter = columnIndexToLetter(columnIndex);
    const url = `${GRAPH_API_URL}/me/drive/items/${fileId}/workbook/worksheets/${encodedSheetName}/range(address='${columnLetter}:${columnLetter}')`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
    } catch (err) {
      throw new SpreadsheetError(`Network error during unique values retrieval: ${String(err)}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new SpreadsheetError(`Invalid JSON response from Graph API: HTTP ${response.status}`);
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = 'Could not parse error body';
      }
      console.error({
        endpoint: 'ExcelOnlineAdapter.getUniqueValues',
        code: 'GRAPH_API_ERROR',
        status: response.status,
        errorBody,
      });
      throw new SpreadsheetError(
        `Graph API error during unique values retrieval: HTTP ${response.status}`,
      );
    }

    return parseUniqueValuesResponse(data);
  }

  validateAccess(_fileId: string, _sheetName: string): Promise<boolean> {
    return Promise.reject(new SpreadsheetError('validateAccess not yet implemented'));
  }

  async validateSpreadsheetAccess(
    fileId: string,
    sheetName: string,
  ): Promise<SpreadsheetAccessResult> {
    const previewResult = await this.fetchPreview(fileId, sheetName);

    if (previewResult.kind === 'access-error') {
      return previewResult;
    }

    if (previewResult.kind === 'empty-sheet') {
      return previewResult;
    }

    const writeResult = await this.checkWritePermission(fileId);

    if (writeResult.kind === 'access-error') {
      return writeResult;
    }

    if (!writeResult.canEdit) {
      return { kind: 'read-only', preview: previewResult.preview };
    }

    return { kind: 'success', preview: previewResult.preview };
  }

  private async fetchPreview(
    fileId: string,
    sheetName: string,
  ): Promise<
    | { kind: 'preview'; preview: SpreadsheetPreview }
    | { kind: 'empty-sheet' }
    | {
        kind: 'access-error';
        errorType: 'network-error' | 'token-expired' | 'permission-denied' | 'unknown';
        retryable: boolean;
      }
  > {
    const encodedSheetName = encodeURIComponent(sheetName);
    const url = `${GRAPH_API_URL}/me/drive/items/${fileId}/workbook/worksheets/${encodedSheetName}/range(address='A1:J10')`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
    } catch {
      return { kind: 'access-error', errorType: 'network-error', retryable: true };
    }

    if (response.status === 401) {
      return { kind: 'access-error', errorType: 'token-expired', retryable: true };
    }

    if (response.status === 403) {
      return { kind: 'access-error', errorType: 'permission-denied', retryable: true };
    }

    if (!response.ok) {
      console.error({
        endpoint: 'ExcelOnlineAdapter.fetchPreview',
        code: 'GRAPH_API_ERROR',
        status: response.status,
      });
      return { kind: 'access-error', errorType: 'unknown', retryable: true };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { kind: 'access-error', errorType: 'unknown', retryable: true };
    }

    const rows = parsePreviewRows(data);

    if (rows.length === 0) {
      return { kind: 'empty-sheet' };
    }

    const preview = new SpreadsheetPreview({
      provider: 'microsoft',
      fileId,
      sheetName,
      rows,
    });

    return { kind: 'preview', preview };
  }

  private async checkWritePermission(fileId: string): Promise<
    | { kind: 'can-edit'; canEdit: true }
    | { kind: 'cannot-edit'; canEdit: false }
    | {
        kind: 'access-error';
        errorType: 'network-error' | 'token-expired' | 'permission-denied' | 'unknown';
        retryable: boolean;
      }
  > {
    const url = `${GRAPH_API_URL}/me/drive/items/${fileId}?$select=capabilities`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
    } catch {
      return { kind: 'access-error', errorType: 'network-error', retryable: true };
    }

    if (response.status === 401) {
      return { kind: 'access-error', errorType: 'token-expired', retryable: true };
    }

    if (response.status === 403) {
      return { kind: 'access-error', errorType: 'permission-denied', retryable: true };
    }

    if (!response.ok) {
      console.error({
        endpoint: 'ExcelOnlineAdapter.checkWritePermission',
        code: 'GRAPH_API_ERROR',
        status: response.status,
      });
      return { kind: 'access-error', errorType: 'unknown', retryable: true };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { kind: 'access-error', errorType: 'unknown', retryable: true };
    }

    const canEdit = parseCanEdit(data);
    return canEdit ? { kind: 'can-edit', canEdit: true } : { kind: 'cannot-edit', canEdit: false };
  }
}

// ── Response parsers ─────────────────────────────────────────────────────────

function parseListSheetsResponse(data: unknown): SheetInfo[] {
  if (typeof data !== 'object' || data === null || !('value' in data)) {
    throw new SpreadsheetError('Unexpected response format from Graph API');
  }

  const sheets = (data as Record<string, unknown>).value;
  if (!Array.isArray(sheets)) {
    throw new SpreadsheetError('Unexpected response format from Graph API');
  }

  return sheets.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new SpreadsheetError('Invalid sheet item in Graph API response');
    }

    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name : '';
    const position = typeof obj.position === 'number' ? obj.position : index;

    if (!name) {
      throw new SpreadsheetError('Invalid sheet item in Graph API response');
    }

    return new SheetInfo({ name, index: position });
  });
}

function parseGetHeadersResponse(data: unknown): string[] {
  if (typeof data !== 'object' || data === null) {
    throw new SpreadsheetError('Unexpected response format from Graph API');
  }

  const values = (data as Record<string, unknown>).values;
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const firstRow = values[0] as unknown;
  if (!Array.isArray(firstRow)) {
    throw new SpreadsheetError('Unexpected response format from Graph API');
  }

  return firstRow.map((cell) => (typeof cell === 'string' ? cell : String(cell)));
}

function parsePreviewRows(data: unknown): Row[] {
  if (typeof data !== 'object' || data === null) {
    return [];
  }

  const values = (data as Record<string, unknown>).values;
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((row, index) => {
    if (!Array.isArray(row)) {
      return { index: index + 1, values: [] };
    }
    return {
      index: index + 1,
      values: row.map((cell) => (typeof cell === 'string' ? cell : String(cell))),
    };
  });
}

function parseCanEdit(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const capabilities = (data as Record<string, unknown>).capabilities;
  if (typeof capabilities !== 'object' || capabilities === null) {
    return false;
  }

  const canEdit = (capabilities as Record<string, unknown>).canEdit;
  return canEdit === true;
}

function columnIndexToLetter(index: number): string {
  if (index < 0) {
    throw new SpreadsheetError(`Invalid column index: ${index}`);
  }

  let result = '';
  let remaining = index;
  do {
    result = String.fromCharCode((remaining % 26) + 65) + result;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);

  return result;
}

function parseUniqueValuesResponse(data: unknown): string[] {
  if (typeof data !== 'object' || data === null) {
    return [];
  }

  const values = (data as Record<string, unknown>).values;
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((row): row is unknown[] => Array.isArray(row) && row.length > 0)
    .map((row) => {
      const firstCell = row[0];
      return typeof firstCell === 'string' ? firstCell : String(firstCell);
    });
}
