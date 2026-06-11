// LAYER: Domain / Tests
// Unit tests for SheetInfo value object.
// Validates construction rules, immutability, and equality.

import { describe, it, expect } from 'vitest';
import { SheetInfo } from './SheetInfo';
import { DomainValidationError } from '../errors/DomainValidationError';

function makeValidProps() {
  return {
    name: 'Gastos',
    index: 0,
  };
}

describe('SheetInfo', () => {
  describe('construction', () => {
    it('creates a valid SheetInfo with all required fields', () => {
      const props = makeValidProps();
      const sheet = new SheetInfo(props);

      expect(sheet.name).toBe('Gastos');
      expect(sheet.index).toBe(0);
    });

    it('trims whitespace from name', () => {
      const sheet = new SheetInfo({ name: '  Gastos  ', index: 1 });
      expect(sheet.name).toBe('Gastos');
    });

    it('throws DomainValidationError when name is empty', () => {
      const props = { ...makeValidProps(), name: '' };
      expect(() => new SheetInfo(props)).toThrow(DomainValidationError);
      expect(() => new SheetInfo(props)).toThrow('name is required');
    });

    it('throws DomainValidationError when name is whitespace only', () => {
      const props = { ...makeValidProps(), name: '   ' };
      expect(() => new SheetInfo(props)).toThrow(DomainValidationError);
    });

    it('throws DomainValidationError when index is negative', () => {
      const props = { ...makeValidProps(), index: -1 };
      expect(() => new SheetInfo(props)).toThrow(DomainValidationError);
      expect(() => new SheetInfo(props)).toThrow('index must be a non-negative integer');
    });

    it('throws DomainValidationError when index is not an integer', () => {
      const props = { ...makeValidProps(), index: 1.5 };
      expect(() => new SheetInfo(props)).toThrow(DomainValidationError);
      expect(() => new SheetInfo(props)).toThrow('index must be a non-negative integer');
    });
  });

  describe('immutability', () => {
    it('throws when attempting to mutate name at runtime', () => {
      const sheet = new SheetInfo(makeValidProps());
      expect(() => {
        (sheet as unknown as Record<string, unknown>).name = 'new name';
      }).toThrow();
    });

    it('throws when attempting to mutate index at runtime', () => {
      const sheet = new SheetInfo(makeValidProps());
      expect(() => {
        (sheet as unknown as Record<string, unknown>).index = 999;
      }).toThrow();
    });
  });

  describe('equality', () => {
    it('returns true for two sheets with identical properties', () => {
      const props = makeValidProps();
      const a = new SheetInfo(props);
      const b = new SheetInfo(props);
      expect(a.equals(b)).toBe(true);
    });

    it('returns false when name differs', () => {
      const a = new SheetInfo(makeValidProps());
      const b = new SheetInfo({ ...makeValidProps(), name: 'Other' });
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when index differs', () => {
      const a = new SheetInfo(makeValidProps());
      const b = new SheetInfo({ ...makeValidProps(), index: 1 });
      expect(a.equals(b)).toBe(false);
    });
  });
});
