// LAYER: Infrastructure
// Google Sheets adapter. Uses direct fetch calls to Google Sheets API v4.
// Does not depend on googleapis SDK to keep the dependency surface minimal.

import type { SpreadsheetPort, Row, AppendResult, CellValue } from '../../../domain/ports/services';
import { SheetInfo } from '../../../domain/entities/SheetInfo';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

const GOOGLE_SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

export class GoogleSheetsAdapter implements SpreadsheetPort {
  constructor(private readonly accessToken: string) {}

  async listSheets(fileId: string): Promise<SheetInfo[]> {
    const url = `${GOOGLE_SHEETS_API_URL}/${fileId}?fields=sheets.properties(title,index)`;

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
      throw new SpreadsheetError(
        `Invalid JSON response from Google Sheets API: HTTP ${response.status}`,
      );
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = 'Could not parse error body';
      }
      console.error({
        endpoint: 'GoogleSheetsAdapter.listSheets',
        code: 'SHEETS_API_ERROR',
        status: response.status,
        errorBody,
      });
      throw new SpreadsheetError(
        `Google Sheets API error during sheet listing: HTTP ${response.status}`,
      );
    }

    return parseListSheetsResponse(data);
  }

  async getHeaders(fileId: string, sheetName: string): Promise<string[]> {
    const encodedSheetName = encodeURIComponent(sheetName);
    const url = `${GOOGLE_SHEETS_API_URL}/${fileId}/values/${encodedSheetName}!1:1`;

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
      throw new SpreadsheetError(
        `Invalid JSON response from Google Sheets API: HTTP ${response.status}`,
      );
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = 'Could not parse error body';
      }
      console.error({
        endpoint: 'GoogleSheetsAdapter.getHeaders',
        code: 'SHEETS_API_ERROR',
        status: response.status,
        errorBody,
      });
      throw new SpreadsheetError(
        `Google Sheets API error during header retrieval: HTTP ${response.status}`,
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

  getUniqueValues(_fileId: string, _columnIndex: number, _sheetName: string): Promise<string[]> {
    return Promise.reject(new SpreadsheetError('getUniqueValues not yet implemented'));
  }

  validateAccess(_fileId: string, _sheetName: string): Promise<boolean> {
    return Promise.reject(new SpreadsheetError('validateAccess not yet implemented'));
  }
}

// ── Response parsers ─────────────────────────────────────────────────────────

function parseListSheetsResponse(data: unknown): SheetInfo[] {
  if (typeof data !== 'object' || data === null || !('sheets' in data)) {
    throw new SpreadsheetError('Unexpected response format from Google Sheets API');
  }

  const sheets = (data as Record<string, unknown>).sheets;
  if (!Array.isArray(sheets)) {
    throw new SpreadsheetError('Unexpected response format from Google Sheets API');
  }

  return sheets.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new SpreadsheetError('Invalid sheet item in Google Sheets API response');
    }

    const obj = item as Record<string, unknown>;
    const properties =
      typeof obj.properties === 'object' && obj.properties !== null
        ? (obj.properties as Record<string, unknown>)
        : null;

    if (!properties) {
      throw new SpreadsheetError('Invalid sheet item in Google Sheets API response');
    }

    const title = typeof properties.title === 'string' ? properties.title : '';
    const sheetIndex = typeof properties.index === 'number' ? properties.index : index;

    if (!title) {
      throw new SpreadsheetError('Invalid sheet item in Google Sheets API response');
    }

    return new SheetInfo({ name: title, index: sheetIndex });
  });
}

function parseGetHeadersResponse(data: unknown): string[] {
  if (typeof data !== 'object' || data === null) {
    throw new SpreadsheetError('Unexpected response format from Google Sheets API');
  }

  if (!('values' in data)) {
    return [];
  }

  const values = (data as Record<string, unknown>).values;
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const firstRow = values[0] as unknown;
  if (!Array.isArray(firstRow)) {
    throw new SpreadsheetError('Unexpected response format from Google Sheets API');
  }

  return firstRow.map((cell) => (typeof cell === 'string' ? cell : String(cell)));
}
