// LAYER: Infrastructure
// Provider-aware factory that creates SpreadsheetPort implementations.
// Supports both Google Sheets and Excel Online adapters.

import { GoogleSheetsAdapter } from './GoogleSheetsAdapter';
import { ExcelOnlineAdapter } from './ExcelOnlineAdapter';
import type { SpreadsheetPortFactory, SpreadsheetPort } from '../../../domain/ports/services';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';

export class SpreadsheetPortAdapterFactory implements SpreadsheetPortFactory {
  create(provider: SpreadsheetProvider, accessToken: string): SpreadsheetPort {
    if (provider === 'microsoft') {
      return new ExcelOnlineAdapter(accessToken);
    }
    return new GoogleSheetsAdapter(accessToken);
  }
}
