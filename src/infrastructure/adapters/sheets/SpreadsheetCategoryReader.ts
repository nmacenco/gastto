// LAYER: Infrastructure
// Reads and normalizes the category vocabulary from a spreadsheet column.
// Delegates the raw sheet access to SpreadsheetPort so it works with any
// provider (Google Sheets, Excel Online) and remains testable.

import type { ICategoryReaderPort } from '../../../domain/ports/categoryReader';
import type { SpreadsheetPort } from '../../../domain/ports/services';

export class SpreadsheetCategoryReader implements ICategoryReaderPort {
  constructor(private readonly spreadsheetPort: SpreadsheetPort) {}

  async readCategories(fileId: string, columnIndex: number, sheetName: string): Promise<string[]> {
    const rawValues = await this.spreadsheetPort.getUniqueValues(fileId, columnIndex, sheetName);

    const seen = new Set<string>();
    const categories: string[] = [];

    for (const value of rawValues) {
      const normalized = value.trim().toLowerCase();
      if (normalized.length === 0) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      categories.push(normalized);
    }

    return categories;
  }
}
