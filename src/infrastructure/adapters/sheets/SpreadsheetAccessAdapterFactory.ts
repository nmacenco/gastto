import type { Logger } from 'pino';
// LAYER: Infrastructure
// Factory that creates ValidateSpreadsheetAccessPort implementations
// based on the spreadsheet provider.

import { GoogleSheetsAdapter } from './GoogleSheetsAdapter';
import { ExcelOnlineAdapter } from './ExcelOnlineAdapter';
import type {
  ValidateSpreadsheetAccessPort,
  ValidateSpreadsheetAccessPortFactory,
} from '../../../domain/ports/spreadsheetAccess';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';

export class SpreadsheetAccessAdapterFactory implements ValidateSpreadsheetAccessPortFactory {
  constructor(private readonly logger: Logger) {}

  create(provider: SpreadsheetProvider, accessToken: string): ValidateSpreadsheetAccessPort {
    if (provider === 'microsoft') {
      return new ExcelOnlineAdapter(accessToken, this.logger);
    }
    return new GoogleSheetsAdapter(accessToken);
  }
}
