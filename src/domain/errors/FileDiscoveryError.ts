// LAYER: Domain
// Error thrown when a file discovery operation fails. It participates in the
// shared spreadsheet error taxonomy so OAuth refresh can react to AUTH_ERROR.

import { SpreadsheetError, type SpreadsheetErrorOptions } from './SpreadsheetError';

export class FileDiscoveryError extends SpreadsheetError {
  constructor(
    message: string = 'Failed to discover files in cloud storage',
    options: SpreadsheetErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'FileDiscoveryError';
  }
}
