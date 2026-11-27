// LAYER: Domain
// Error thrown when a spreadsheet operation fails (e.g., API error,
// network failure, or unexpected response from the spreadsheet provider).

export type SpreadsheetErrorCode = 'NETWORK_ERROR' | 'AUTH_ERROR' | 'STRUCTURE_ERROR' | 'UNKNOWN';

export interface ProviderDiagnostic {
  httpStatus: number;
  status?: string;
  reason?: string;
}

const STATUSES = new Set([
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'RESOURCE_EXHAUSTED',
  'INTERNAL',
  'UNAVAILABLE',
  'FAILED_PRECONDITION',
]);
const REASONS = new Set([
  'badRequest',
  'notFound',
  'forbidden',
  'authError',
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'backendError',
  'internalError',
  'accessNotConfigured',
]);

/** Only bounded provider vocabulary can cross the adapter boundary. */
export function safeProviderDiagnostic(value: ProviderDiagnostic): ProviderDiagnostic | undefined {
  if (!Number.isInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599)
    return undefined;
  return {
    httpStatus: value.httpStatus,
    ...(value.status && STATUSES.has(value.status) ? { status: value.status } : {}),
    ...(value.reason && REASONS.has(value.reason) ? { reason: value.reason } : {}),
  };
}

export interface SpreadsheetErrorOptions {
  providerDiagnostic?: ProviderDiagnostic;
  code?: SpreadsheetErrorCode;
  retryable?: boolean;
  /** The provider may have applied the external mutation before the failure was observed. */
  outcomeUnknown?: boolean;
}

export class SpreadsheetError extends Error {
  readonly providerDiagnostic: ProviderDiagnostic | undefined;
  readonly code: SpreadsheetErrorCode;
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;

  constructor(
    message: string = 'Failed to perform spreadsheet operation',
    options: SpreadsheetErrorOptions = {},
  ) {
    super(message);
    this.name = 'SpreadsheetError';
    this.providerDiagnostic = options.providerDiagnostic
      ? safeProviderDiagnostic(options.providerDiagnostic)
      : undefined;
    this.code = options.code ?? 'UNKNOWN';
    this.retryable = options.retryable ?? false;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
  }
}
