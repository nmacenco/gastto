// LAYER: Domain / Tests
// Unit tests for SpreadsheetAccessResult discriminated union.
// Validates that all four variants compile and have correct shape.

import { describe, it, expect } from 'vitest';
import type { SpreadsheetAccessResult } from './SpreadsheetAccessResult';
import { SpreadsheetPreview } from '../entities/SpreadsheetPreview';

function makePreview(): SpreadsheetPreview {
  return new SpreadsheetPreview({
    provider: 'google',
    fileId: 'spreadsheet-123',
    sheetName: 'Gastos',
    rows: [{ index: 1, values: ['Fecha', 'Concepto', 'Monto'] }],
  });
}

describe('SpreadsheetAccessResult', () => {
  describe('success variant', () => {
    it('has kind "success" and includes preview', () => {
      const result: SpreadsheetAccessResult = {
        kind: 'success',
        preview: makePreview(),
      };
      expect(result.kind).toBe('success');
      if (result.kind === 'success') {
        expect(result.preview).toBeInstanceOf(SpreadsheetPreview);
        expect(result.preview.fileId).toBe('spreadsheet-123');
      }
    });
  });

  describe('read-only variant', () => {
    it('has kind "read-only" and includes preview', () => {
      const result: SpreadsheetAccessResult = {
        kind: 'read-only',
        preview: makePreview(),
      };
      expect(result.kind).toBe('read-only');
      if (result.kind === 'read-only') {
        expect(result.preview).toBeInstanceOf(SpreadsheetPreview);
      }
    });
  });

  describe('empty-sheet variant', () => {
    it('has kind "empty-sheet" with no preview', () => {
      const result: SpreadsheetAccessResult = {
        kind: 'empty-sheet',
      };
      expect(result.kind).toBe('empty-sheet');
    });
  });

  describe('access-error variant', () => {
    it('has kind "access-error" with errorType and retryable flag', () => {
      const result: SpreadsheetAccessResult = {
        kind: 'access-error',
        errorType: 'network-error',
        retryable: true,
      };
      expect(result.kind).toBe('access-error');
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('network-error');
        expect(result.retryable).toBe(true);
      }
    });

    it('supports token-expired error type', () => {
      const result: SpreadsheetAccessResult = {
        kind: 'access-error',
        errorType: 'token-expired',
        retryable: true,
      };
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('token-expired');
      }
    });

    it('supports permission-denied error type', () => {
      const result: SpreadsheetAccessResult = {
        kind: 'access-error',
        errorType: 'permission-denied',
        retryable: true,
      };
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('permission-denied');
      }
    });

    it('supports unknown error type with retryable false', () => {
      const result: SpreadsheetAccessResult = {
        kind: 'access-error',
        errorType: 'unknown',
        retryable: false,
      };
      if (result.kind === 'access-error') {
        expect(result.errorType).toBe('unknown');
        expect(result.retryable).toBe(false);
      }
    });
  });

  describe('discriminated union narrowing', () => {
    it('narrows correctly based on kind', () => {
      const results: SpreadsheetAccessResult[] = [
        { kind: 'success', preview: makePreview() },
        { kind: 'read-only', preview: makePreview() },
        { kind: 'empty-sheet' },
        { kind: 'access-error', errorType: 'network-error', retryable: true },
      ];

      const kinds = results.map((r) => r.kind);
      expect(kinds).toEqual(['success', 'read-only', 'empty-sheet', 'access-error']);
    });
  });
});
