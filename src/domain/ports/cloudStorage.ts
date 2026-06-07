// LAYER: Domain
// Cloud storage service port. Allows the Application layer to discover,
// search, and validate spreadsheet files without coupling to Google Drive
// or OneDrive specifics.

import type { CloudFile } from '../entities/CloudFile';
import type { SpreadsheetProvider } from '../entities/SpreadsheetConfig';

export interface CloudStoragePort {
  /** Lists the most recently modified spreadsheet files (max 5). */
  listRecentSpreadsheets(accessToken: string, provider: SpreadsheetProvider): Promise<CloudFile[]>;

  /** Searches spreadsheet files by name query. */
  searchSpreadsheets(
    accessToken: string,
    provider: SpreadsheetProvider,
    query: string,
  ): Promise<CloudFile[]>;

  /** Validates that the given file is accessible by the user. */
  validateFileAccess(
    fileId: string,
    accessToken: string,
    provider: SpreadsheetProvider,
  ): Promise<boolean>;
}
