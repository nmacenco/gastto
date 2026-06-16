// LAYER: Domain
// Port for validating spreadsheet read/write access.
// Keeps the Application layer agnostic of the spreadsheet provider
// (Google Sheets vs Excel Online).

import type { SpreadsheetAccessResult } from '../value-objects/SpreadsheetAccessResult';

export interface ValidateSpreadsheetAccessPort {
  validateSpreadsheetAccess(
    fileId: string,
    sheetName: string,
  ): Promise<SpreadsheetAccessResult>;
}
