// LAYER: Infrastructure
// Creates hierarchy readers bound to a provider-specific SpreadsheetPort.

import type {
  ICategoryHierarchyReaderPort,
  ICategoryHierarchyReaderPortFactory,
} from '../../../domain/ports/categoryHierarchyReader';
import type { SpreadsheetPortFactory } from '../../../domain/ports/services';
import { SpreadsheetCategoryHierarchyReader } from './SpreadsheetCategoryHierarchyReader';

export class SpreadsheetCategoryHierarchyReaderFactory implements ICategoryHierarchyReaderPortFactory {
  constructor(private readonly spreadsheetPortFactory: SpreadsheetPortFactory) {}

  create(accessToken: string): ICategoryHierarchyReaderPort {
    return new SpreadsheetCategoryHierarchyReader(this.spreadsheetPortFactory.create(accessToken));
  }
}
