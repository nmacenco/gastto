import type { Logger } from 'pino';
// LAYER: Infrastructure
// Factory that creates ExcelOnlineAdapter instances with a fresh access token.

import type { SpreadsheetPortFactory } from '../../../domain/ports/services';
import { ExcelOnlineAdapter } from './ExcelOnlineAdapter';

export class ExcelOnlineAdapterFactory implements SpreadsheetPortFactory {
  constructor(private readonly logger: Logger) {}

  create(accessToken: string): ExcelOnlineAdapter {
    return new ExcelOnlineAdapter(accessToken, this.logger);
  }
}
