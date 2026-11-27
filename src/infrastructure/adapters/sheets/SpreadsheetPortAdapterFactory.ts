import type { Logger } from 'pino';
// LAYER: Infrastructure
// Provider-aware factory that creates SpreadsheetPort implementations.
// Supports both Google Sheets and Excel Online adapters.

import { GoogleSheetsAdapter } from './GoogleSheetsAdapter';
import { ExcelOnlineAdapter } from './ExcelOnlineAdapter';
import type { SpreadsheetPort } from '../../../domain/ports/services';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';

export class SpreadsheetPortAdapterFactory {
  constructor(private readonly logger: Logger) {}

  create(provider: SpreadsheetProvider, accessToken: string): SpreadsheetPort {
    if (provider === 'microsoft') {
      return new ExcelOnlineAdapter(accessToken, this.logger);
    }
    return new GoogleSheetsAdapter(accessToken);
  }
}
