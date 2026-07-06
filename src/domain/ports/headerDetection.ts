// LAYER: Domain
// Port for detecting which row in a spreadsheet contains the column headers.
// Decouples the inference strategy from the row-scanning strategy.

import type { Row } from './services';

export interface HeaderDetectionPort {
  // Returns the 1-based sheet row index that contains the headers,
  // or null when no row can be confidently identified as headers.
  detectHeaderRow(rows: Row[]): Promise<number | null>;
}
