// LAYER: Domain / Tests
// Unit tests for SpreadsheetPreview entity.
// Validates construction rules, immutability, and equality.

import { describe, it, expect } from 'vitest';
import { SpreadsheetPreview } from './SpreadsheetPreview';
import { DomainValidationError } from '../errors/DomainValidationError';

function makeValidProps() {
  return {
    provider: 'google' as const,
    fileId: 'spreadsheet-123',
    sheetName: 'Gastos',
    rows: [{ index: 1, values: ['Fecha', 'Concepto', 'Monto'] }],
  };
}

describe('SpreadsheetPreview', () => {
  describe('construction', () => {
    it('creates a valid SpreadsheetPreview with all required fields', () => {
      const props = makeValidProps();
      const preview = new SpreadsheetPreview(props);

      expect(preview.provider).toBe('google');
      expect(preview.fileId).toBe('spreadsheet-123');
      expect(preview.sheetName).toBe('Gastos');
      expect(preview.rows).toEqual([{ index: 1, values: ['Fecha', 'Concepto', 'Monto'] }]);
    });

    it('accepts microsoft as provider', () => {
      const preview = new SpreadsheetPreview({ ...makeValidProps(), provider: 'microsoft' });
      expect(preview.provider).toBe('microsoft');
    });

    it('trims whitespace from fileId and sheetName', () => {
      const preview = new SpreadsheetPreview({
        ...makeValidProps(),
        fileId: '  spreadsheet-123  ',
        sheetName: '  Gastos  ',
      });
      expect(preview.fileId).toBe('spreadsheet-123');
      expect(preview.sheetName).toBe('Gastos');
    });

    it('allows empty rows array', () => {
      const preview = new SpreadsheetPreview({ ...makeValidProps(), rows: [] });
      expect(preview.rows).toEqual([]);
    });

    it('throws DomainValidationError when provider is invalid', () => {
      const props = {
        ...makeValidProps(),
        provider: 'dropbox' as unknown as 'google',
      };
      expect(() => new SpreadsheetPreview(props)).toThrow(DomainValidationError);
      expect(() => new SpreadsheetPreview(props)).toThrow('provider must be');
    });

    it('throws DomainValidationError when fileId is empty', () => {
      const props = { ...makeValidProps(), fileId: '' };
      expect(() => new SpreadsheetPreview(props)).toThrow(DomainValidationError);
      expect(() => new SpreadsheetPreview(props)).toThrow('fileId is required');
    });

    it('throws DomainValidationError when fileId is whitespace only', () => {
      const props = { ...makeValidProps(), fileId: '   ' };
      expect(() => new SpreadsheetPreview(props)).toThrow(DomainValidationError);
    });

    it('throws DomainValidationError when sheetName is empty', () => {
      const props = { ...makeValidProps(), sheetName: '' };
      expect(() => new SpreadsheetPreview(props)).toThrow(DomainValidationError);
      expect(() => new SpreadsheetPreview(props)).toThrow('sheetName is required');
    });

    it('throws DomainValidationError when rows is not an array', () => {
      const props = { ...makeValidProps(), rows: 'not-an-array' as unknown as [] };
      expect(() => new SpreadsheetPreview(props)).toThrow(DomainValidationError);
      expect(() => new SpreadsheetPreview(props)).toThrow('rows must be an array');
    });
  });

  describe('immutability', () => {
    it('throws when attempting to mutate provider at runtime', () => {
      const preview = new SpreadsheetPreview(makeValidProps());
      expect(() => {
        (preview as unknown as Record<string, unknown>).provider = 'microsoft';
      }).toThrow();
    });

    it('throws when attempting to mutate fileId at runtime', () => {
      const preview = new SpreadsheetPreview(makeValidProps());
      expect(() => {
        (preview as unknown as Record<string, unknown>).fileId = 'other-id';
      }).toThrow();
    });

    it('throws when attempting to mutate sheetName at runtime', () => {
      const preview = new SpreadsheetPreview(makeValidProps());
      expect(() => {
        (preview as unknown as Record<string, unknown>).sheetName = 'Other';
      }).toThrow();
    });
  });

  describe('equality', () => {
    it('returns true for two previews with identical properties', () => {
      const props = makeValidProps();
      const a = new SpreadsheetPreview(props);
      const b = new SpreadsheetPreview(props);
      expect(a.equals(b)).toBe(true);
    });

    it('returns false when provider differs', () => {
      const a = new SpreadsheetPreview(makeValidProps());
      const b = new SpreadsheetPreview({ ...makeValidProps(), provider: 'microsoft' });
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when fileId differs', () => {
      const a = new SpreadsheetPreview(makeValidProps());
      const b = new SpreadsheetPreview({ ...makeValidProps(), fileId: 'other-id' });
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when sheetName differs', () => {
      const a = new SpreadsheetPreview(makeValidProps());
      const b = new SpreadsheetPreview({ ...makeValidProps(), sheetName: 'Other' });
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when rows differ', () => {
      const a = new SpreadsheetPreview(makeValidProps());
      const b = new SpreadsheetPreview({
        ...makeValidProps(),
        rows: [{ index: 2, values: ['Different'] }],
      });
      expect(a.equals(b)).toBe(false);
    });
  });
});
