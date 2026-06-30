// LAYER: Infrastructure
// Adapter that reads unique category values from a mapped spreadsheet column.
// Normalizes whitespace, deduplicates case-insensitively, filters empty cells,
// and returns sorted unique strings.

import type { Logger } from 'pino';
import type {
  CategoryReaderPort,
  ReadUniqueCategoriesInput,
} from '../../../domain/ports/categoryVocabulary';
import type { SpreadsheetPortFactory } from '../../../domain/ports/services';
import { normalizeCategoryName } from '../../../domain/value-objects/Category';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

export class SpreadsheetCategoryReader implements CategoryReaderPort {
  constructor(
    private readonly spreadsheetPortFactory: SpreadsheetPortFactory,
    private readonly logger: Logger,
  ) {}

  async readUniqueCategories(input: ReadUniqueCategoriesInput): Promise<string[]> {
    const { provider, fileId, sheetName, accessToken, columnIndex } = input;

    const spreadsheetPort = this.spreadsheetPortFactory.create(provider, accessToken);

    let rawValues: string[];
    try {
      rawValues = await spreadsheetPort.getUniqueValues(fileId, columnIndex, sheetName);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error({
        endpoint: 'SpreadsheetCategoryReader.readUniqueCategories',
        code: 'UNIQUE_VALUES_READ_ERROR',
        provider,
        fileId,
        sheetName,
        columnIndex,
        error: errorMessage,
      });

      if (err instanceof SpreadsheetError) {
        throw err;
      }
      throw new SpreadsheetError(`Failed to read unique categories: ${errorMessage}`);
    }

    return normalizeUniqueValues(rawValues);
  }
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeUniqueValues(rawValues: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const raw of rawValues) {
    const cleaned = collapseWhitespace(raw);
    if (cleaned === '') {
      continue;
    }

    const comparisonKey = normalizeCategoryName(cleaned);
    if (seen.has(comparisonKey)) {
      continue;
    }

    seen.add(comparisonKey);
    unique.push(cleaned);
  }

  return unique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
