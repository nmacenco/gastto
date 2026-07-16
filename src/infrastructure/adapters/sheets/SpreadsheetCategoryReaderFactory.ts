// LAYER: Infrastructure
// Factory that creates ICategoryReaderPort instances bound to a
// decrypted OAuth access token. Wired in main.ts (Interfaces layer).

import type { SpreadsheetPortFactory } from '../../../domain/ports/services';
import type {
  ICategoryReaderPort,
  ICategoryReaderPortFactory,
} from '../../../domain/ports/categoryReader';
import { SpreadsheetCategoryReader } from './SpreadsheetCategoryReader';

export class SpreadsheetCategoryReaderFactory implements ICategoryReaderPortFactory {
  constructor(private readonly spreadsheetPortFactory: SpreadsheetPortFactory) {}

  create(accessToken: string): ICategoryReaderPort {
    const spreadsheetPort = this.spreadsheetPortFactory.create(accessToken);
    return new SpreadsheetCategoryReader(spreadsheetPort);
  }
}
