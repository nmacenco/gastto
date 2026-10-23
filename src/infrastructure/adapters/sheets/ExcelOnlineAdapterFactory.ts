// LAYER: Infrastructure
// Factory that creates ExcelOnlineAdapter instances with a fresh access token.

import type { SpreadsheetPortFactory } from '../../../domain/ports/services';
import { ExcelOnlineAdapter } from './ExcelOnlineAdapter';

export class ExcelOnlineAdapterFactory implements SpreadsheetPortFactory {
  create(accessToken: string): ExcelOnlineAdapter {
    return new ExcelOnlineAdapter(accessToken);
  }
}
