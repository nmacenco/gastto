// LAYER: Domain
// Discriminated union representing the outcome of a spreadsheet access validation.
// Covers all four HU-4.04 scenarios: success, read-only, empty-sheet, access-error.

import type { SpreadsheetPreview } from '../entities/SpreadsheetPreview';

export type SpreadsheetAccessErrorType =
  | 'network-error'
  | 'token-expired'
  | 'permission-denied'
  | 'unknown';

export type SpreadsheetAccessResult =
  | { readonly kind: 'success'; readonly preview: SpreadsheetPreview }
  | { readonly kind: 'read-only'; readonly preview: SpreadsheetPreview }
  | { readonly kind: 'empty-sheet' }
  | {
      readonly kind: 'access-error';
      readonly errorType: SpreadsheetAccessErrorType;
      readonly retryable: boolean;
    };
