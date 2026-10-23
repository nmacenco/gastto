// LAYER: Infrastructure
// Reads linked category/subcategory values while preserving spreadsheet rows.

import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import type {
  CategoryHierarchyReadResult,
  CategorySubcategoryPair,
  ICategoryHierarchyReaderPort,
} from '../../../domain/ports/categoryHierarchyReader';
import type { CellValue, SpreadsheetPort } from '../../../domain/ports/services';

export class SpreadsheetCategoryHierarchyReader implements ICategoryHierarchyReaderPort {
  constructor(private readonly spreadsheetPort: SpreadsheetPort) {}

  async readHierarchy(
    fileId: string,
    categoryColumnIndex: number,
    subcategoryColumnIndex: number,
    sheetName: string,
    dataStartRow: number = 2,
  ): Promise<CategoryHierarchyReadResult> {
    assertColumnIndex(categoryColumnIndex, 'Category');
    assertColumnIndex(subcategoryColumnIndex, 'Subcategory');
    assertDataStartRow(dataStartRow);

    const lastColumnIndex = Math.max(categoryColumnIndex, subcategoryColumnIndex);
    const range = buildRowRange(sheetName, lastColumnIndex, dataStartRow);
    const rows = await this.spreadsheetPort.readRows(fileId, range);

    const categories: string[] = [];
    const pairs: CategorySubcategoryPair[] = [];
    const orphanSubcategories: string[] = [];
    const seenCategories = new Set<string>();
    const seenPairs = new Set<string>();
    const seenOrphans = new Set<string>();

    for (const row of rows) {
      const category = normalizeCell(row.values[categoryColumnIndex]);
      const subcategory = normalizeCell(row.values[subcategoryColumnIndex]);

      if (category.length > 0 && !seenCategories.has(category)) {
        seenCategories.add(category);
        categories.push(category);
      }

      if (subcategory.length === 0) continue;

      if (category.length === 0) {
        if (!seenOrphans.has(subcategory)) {
          seenOrphans.add(subcategory);
          orphanSubcategories.push(subcategory);
        }
        continue;
      }

      const pairKey = `${category}\u0000${subcategory}`;
      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        pairs.push({ category, subcategory });
      }
    }

    return { categories, pairs, orphanSubcategories };
  }
}

function assertColumnIndex(index: number, fieldName: string): void {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new SpreadsheetError(`${fieldName} column index must be a non-negative integer`, {
      code: 'STRUCTURE_ERROR',
    });
  }
}

function assertDataStartRow(row: number): void {
  if (!Number.isSafeInteger(row) || row < 1) {
    throw new SpreadsheetError('Data start row must be a positive integer', {
      code: 'STRUCTURE_ERROR',
    });
  }
}

function buildRowRange(sheetName: string, lastColumnIndex: number, dataStartRow: number): string {
  const quotedSheetName = sheetName.replace(/'/g, "''");
  return `'${quotedSheetName}'!A${dataStartRow}:${columnIndexToLetter(lastColumnIndex)}`;
}

function columnIndexToLetter(index: number): string {
  let result = '';
  let remaining = index;
  do {
    result = String.fromCharCode((remaining % 26) + 65) + result;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return result;
}

function normalizeCell(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}
