// LAYER: Infrastructure
// Google Sheets adapter. Uses direct fetch calls to Google Sheets API v4.
// Does not depend on googleapis SDK to keep the dependency surface minimal.

import type { SpreadsheetPort, Row, AppendResult, CellValue } from '../../../domain/ports/services';
import type { ValidateSpreadsheetAccessPort } from '../../../domain/ports/spreadsheetAccess';
import type {
  ISpreadsheetColumnPort,
  AvailableColumn,
} from '../../../domain/ports/spreadsheetColumns';
import type { SpreadsheetAccessResult } from '../../../domain/value-objects/SpreadsheetAccessResult';
import { SheetInfo } from '../../../domain/entities/SheetInfo';
import { SpreadsheetPreview } from '../../../domain/entities/SpreadsheetPreview';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

const GOOGLE_SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const GOOGLE_DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';

export class GoogleSheetsAdapter
  implements SpreadsheetPort, ValidateSpreadsheetAccessPort, ISpreadsheetColumnPort
{
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

  async getHeaders(
    fileId: string,
    sheetName: string,
    headerRowIndex: number = 1,
  ): Promise<string[]> {
    const encodedSheetName = encodeURIComponent(sheetName);
    const url = `${GOOGLE_SHEETS_API_URL}/${fileId}/values/${encodedSheetName}!${headerRowIndex}:${headerRowIndex}`;

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

  async listAvailableColumns(input: {
    provider: 'google' | 'microsoft';
    fileId: string;
    sheetName: string;
    accessToken: string;
    headerRowIndex?: number;
  }): Promise<AvailableColumn[]> {
    // Use the access token supplied in the input so a single port instance can
    // serve requests for different users/sessions.
    const client = new GoogleSheetsAdapter(input.accessToken);
    const headers = await client.getHeaders(
      input.fileId,
      input.sheetName,
      input.headerRowIndex ?? 1,
    );
    return headers.map((columnHeader, index) => ({ index, columnHeader }));
  }

  readRows(_fileId: string, _range: string): Promise<Row[]> {
    return Promise.reject(new SpreadsheetError('readRows not yet implemented'));
  }

  async appendRow(fileId: string, sheetName: string, values: CellValue[]): Promise<AppendResult> {
    const encodedSheetName = encodeURIComponent(sheetName);
    const url = `${GOOGLE_SHEETS_API_URL}/${fileId}/values/${encodedSheetName}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [values] }),
      });
    } catch (err) {
      throw new SpreadsheetError(`Network error during row append: ${String(err)}`, {
        code: 'NETWORK_ERROR',
        retryable: true,
      });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new SpreadsheetError(
        `Invalid JSON response from Google Sheets API: HTTP ${response.status}`,
        { code: 'STRUCTURE_ERROR' },
      );
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new SpreadsheetError(
          `Google Sheets authorization error during row append: HTTP ${response.status}`,
          { code: 'AUTH_ERROR' },
        );
      }

      if (response.status === 400 || response.status === 404) {
        throw new SpreadsheetError(
          `Google Sheets structure error during row append: HTTP ${response.status}`,
          { code: 'STRUCTURE_ERROR' },
        );
      }

      throw new SpreadsheetError(
        `Google Sheets API error during row append: HTTP ${response.status}`,
        { code: 'UNKNOWN' },
      );
    }

    return parseAppendResponse(data, sheetName);
  }

  async deleteRow(fileId: string, sheetName: string, rowIndex: number): Promise<void> {
    const metadataUrl = `${GOOGLE_SHEETS_API_URL}/${fileId}?fields=sheets.properties(sheetId,title)`;
    let metadataResponse: Response;
    try {
      metadataResponse = await fetch(metadataUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
    } catch (error) {
      throw new SpreadsheetError(`Network error during sheet lookup: ${String(error)}`);
    }

    let metadata: unknown;
    try {
      metadata = await metadataResponse.json();
    } catch {
      throw new SpreadsheetError(
        `Invalid JSON response from Google Sheets API: HTTP ${metadataResponse.status}`,
      );
    }
    if (!metadataResponse.ok) {
      throw new SpreadsheetError(
        `Google Sheets API error during sheet lookup: HTTP ${metadataResponse.status}`,
      );
    }

    const sheetId = findGoogleSheetId(metadata, sheetName);
    if (sheetId === null)
      throw new SpreadsheetError(`Sheet structure error: sheet '${sheetName}' not found`);

    let deleteResponse: Response;
    try {
      deleteResponse = await fetch(`${GOOGLE_SHEETS_API_URL}/${fileId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              deleteDimension: {
                range: { sheetId, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex },
              },
            },
          ],
        }),
      });
    } catch (error) {
      throw new SpreadsheetError(`Network error during row deletion: ${String(error)}`);
    }
    if (!deleteResponse.ok) {
      throw new SpreadsheetError(
        `Google Sheets API error during row deletion: HTTP ${deleteResponse.status}`,
      );
    }
  }

  async getUniqueValues(fileId: string, columnIndex: number, sheetName: string): Promise<string[]> {
    const columnLetter = columnIndexToLetter(columnIndex);
    const encodedSheetName = encodeURIComponent(sheetName);
    const url = `${GOOGLE_SHEETS_API_URL}/${fileId}/values/${encodedSheetName}!${columnLetter}2:${columnLetter}`;

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
        endpoint: 'GoogleSheetsAdapter.getUniqueValues',
        code: 'SHEETS_API_ERROR',
        status: response.status,
        errorBody,
      });
      throw new SpreadsheetError(
        `Google Sheets API error during unique values retrieval: HTTP ${response.status}`,
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
    const url = `${GOOGLE_SHEETS_API_URL}/${fileId}/values/${encodedSheetName}!1:20`;

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
        endpoint: 'GoogleSheetsAdapter.fetchPreview',
        code: 'SHEETS_API_ERROR',
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
      provider: 'google',
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
    const url = `${GOOGLE_DRIVE_API_URL}/${fileId}?fields=capabilities(canEdit)`;

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
        endpoint: 'GoogleSheetsAdapter.checkWritePermission',
        code: 'DRIVE_API_ERROR',
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

function parseAppendResponse(data: unknown, sheetName: string): AppendResult {
  if (!isRecord(data) || !isRecord(data.updates) || typeof data.updates.updatedRange !== 'string') {
    throw new SpreadsheetError('Invalid append response from Google Sheets API', {
      code: 'STRUCTURE_ERROR',
    });
  }

  const rowMatch = data.updates.updatedRange.match(/![A-Z]+(\d+)(?::[A-Z]+\d+)?$/i);
  if (!rowMatch?.[1]) {
    return { sheet: sheetName };
  }

  const row = Number(rowMatch[1]);
  if (!Number.isSafeInteger(row) || row < 1) {
    throw new SpreadsheetError('Invalid row reference in Google Sheets append response', {
      code: 'STRUCTURE_ERROR',
    });
  }

  return { sheet: sheetName, row };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function findGoogleSheetId(data: unknown, sheetName: string): number | null {
  if (!isRecord(data) || !Array.isArray(data.sheets)) {
    throw new SpreadsheetError('Unexpected sheet metadata response from Google Sheets API');
  }

  for (const sheet of data.sheets) {
    if (!isRecord(sheet) || !isRecord(sheet.properties)) continue;
    const { title, sheetId } = sheet.properties;
    if (title === sheetName && typeof sheetId === 'number' && Number.isInteger(sheetId)) {
      return sheetId;
    }
  }
  return null;
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

function parsePreviewRows(data: unknown): Row[] {
  if (typeof data !== 'object' || data === null) {
    return [];
  }

  if (!('values' in data)) {
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

function columnIndexToLetter(index: number): string {
  if (index < 0) throw new SpreadsheetError('Column index must be non-negative');
  let result = '';
  let n = index;
  do {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

function parseUniqueValuesResponse(data: unknown): string[] {
  if (typeof data !== 'object' || data === null) {
    return [];
  }

  if (!('values' in data)) {
    return [];
  }

  const values = (data as Record<string, unknown>).values;
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const row of values) {
    if (!Array.isArray(row) || row.length === 0) continue;
    const cell: unknown = row[0];
    const text = typeof cell === 'string' ? cell.trim() : String(cell).trim();
    if (text.length === 0) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }

  return result;
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
