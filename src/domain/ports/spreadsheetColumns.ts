// LAYER: Domain
// Port for querying the columns available in a user's spreadsheet.
// Implemented by infrastructure adapters that wrap the provider-specific
// spreadsheet access logic (Google Sheets / Excel Online).

import type { SpreadsheetProvider } from '../entities/SpreadsheetConfig';

export interface AvailableColumn {
  index: number;
  columnHeader: string;
}

export interface ListAvailableColumnsInput {
  provider: SpreadsheetProvider;
  fileId: string;
  sheetName: string;
  accessToken: string;
}

export interface ISpreadsheetColumnPort {
  listAvailableColumns(input: ListAvailableColumnsInput): Promise<AvailableColumn[]>;
}
