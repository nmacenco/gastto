// LAYER: Infrastructure
// Factory that creates GoogleSheetsAdapter instances with a fresh access token.
// Implements the SpreadsheetPortFactory domain port for Google provider only.

import { GoogleSheetsAdapter } from './GoogleSheetsAdapter';
import { InvalidProviderError } from '../../../domain/errors/InvalidProviderError';
import type { SpreadsheetPortFactory, SpreadsheetPort } from '../../../domain/ports/services';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';

export class GoogleSheetsAdapterFactory implements SpreadsheetPortFactory {
  create(provider: SpreadsheetProvider, accessToken: string): SpreadsheetPort {
    if (provider !== 'google') {
      throw new InvalidProviderError(provider);
    }
    return new GoogleSheetsAdapter(accessToken);
  }
}
