import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

export interface ParsedSpreadsheetRange {
  sheetName: string;
  address: string;
  startRow: number;
}

const A1_RANGE_PATTERN =
  /^(?:'((?:[^']|'')+)'|([^'!]+))!((?:\$?[A-Za-z]+)\$?([1-9]\d*)(?::(?:\$?[A-Za-z]+)(?:\$?[1-9]\d*)?)?)$/;

/**
 * Parses the provider-neutral readRows range contract: a worksheet-qualified A1
 * range whose first cell includes a positive 1-based row (for example,
 * `Gastos!A2:F` or `'Gastos 2026'!A2:F50`).
 */
export function parseSpreadsheetRange(range: string): ParsedSpreadsheetRange {
  const match = A1_RANGE_PATTERN.exec(range);
  const quotedSheetName = match?.[1];
  const unquotedSheetName = match?.[2];
  const address = match?.[3];
  const startRowText = match?.[4];

  if (!address || !startRowText) {
    throw invalidRangeError();
  }

  const sheetName = quotedSheetName?.replace(/''/g, "'") ?? unquotedSheetName?.trim();
  const startRow = Number(startRowText);
  if (!sheetName || !Number.isSafeInteger(startRow) || startRow < 1) {
    throw invalidRangeError();
  }

  return { sheetName, address, startRow };
}

export function encodeUrlComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function invalidRangeError(): SpreadsheetError {
  return new SpreadsheetError(
    'Range must include a worksheet and an A1 address with a positive starting row',
    { code: 'STRUCTURE_ERROR' },
  );
}
