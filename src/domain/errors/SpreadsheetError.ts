// LAYER: Domain
// Error thrown when a spreadsheet operation fails (e.g., API error,
// network failure, or unexpected response from the spreadsheet provider).

export type SpreadsheetErrorCode = 'NETWORK_ERROR' | 'AUTH_ERROR' | 'STRUCTURE_ERROR' | 'UNKNOWN';

export interface SpreadsheetErrorOptions {
  code?: SpreadsheetErrorCode;
  retryable?: boolean;
  /** The provider may have applied the external mutation before the failure was observed. */
  outcomeUnknown?: boolean;
}

export class SpreadsheetError extends Error {
  readonly code: SpreadsheetErrorCode;
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;

  constructor(
    message: string = 'Failed to perform spreadsheet operation',
    options: SpreadsheetErrorOptions = {},
  ) {
    super(message);
    this.name = 'SpreadsheetError';
    this.code = options.code ?? 'UNKNOWN';
    this.retryable = options.retryable ?? false;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
  }
}
