// LAYER: Infrastructure
// Factory that creates GoogleSheetsAdapter instances with a fresh access token.
// Implements the SpreadsheetPortFactory domain port.

import { GoogleSheetsAdapter } from './GoogleSheetsAdapter';
import type { SpreadsheetPortFactory } from '../../../domain/ports/services';

export class GoogleSheetsAdapterFactory implements SpreadsheetPortFactory {
  create(accessToken: string): GoogleSheetsAdapter {
    return new GoogleSheetsAdapter(accessToken);
  }
}
