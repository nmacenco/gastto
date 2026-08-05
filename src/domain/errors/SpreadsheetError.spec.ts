import { describe, expect, it } from 'vitest';
import { SpreadsheetError } from './SpreadsheetError';

describe('SpreadsheetError', () => {
  it('defaults unknown failures to non-retryable', () => {
    const error = new SpreadsheetError();

    expect(error.code).toBe('UNKNOWN');
    expect(error.retryable).toBe(false);
  });

  it('retains the typed code and retryability supplied by infrastructure', () => {
    const error = new SpreadsheetError('Network failed', {
      code: 'NETWORK_ERROR',
      retryable: true,
    });

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.retryable).toBe(true);
  });
});
