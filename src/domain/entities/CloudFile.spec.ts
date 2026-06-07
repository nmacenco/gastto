// LAYER: Domain / Tests
// Unit tests for CloudFile value object.
// Validates construction rules, immutability, and equality.

import { describe, it, expect } from 'vitest';
import { CloudFile } from './CloudFile';
import { DomainValidationError } from '../errors/DomainValidationError';

function makeValidProps() {
  return {
    id: '1a2b3c4d5e',
    name: 'Gastos 2026',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    modifiedAt: new Date('2026-05-20T12:00:00Z'),
  };
}

describe('CloudFile', () => {
  describe('construction', () => {
    it('creates a valid CloudFile with all required fields', () => {
      const props = makeValidProps();
      const file = new CloudFile(props);

      expect(file.id).toBe('1a2b3c4d5e');
      expect(file.name).toBe('Gastos 2026');
      expect(file.mimeType).toBe('application/vnd.google-apps.spreadsheet');
      expect(file.modifiedAt).toEqual(new Date('2026-05-20T12:00:00Z'));
    });

    it('throws DomainValidationError when id is empty', () => {
      const props = { ...makeValidProps(), id: '' };
      expect(() => new CloudFile(props)).toThrow(DomainValidationError);
      expect(() => new CloudFile(props)).toThrow('id is required');
    });

    it('throws DomainValidationError when id is whitespace only', () => {
      const props = { ...makeValidProps(), id: '   ' };
      expect(() => new CloudFile(props)).toThrow(DomainValidationError);
    });

    it('throws DomainValidationError when name is empty', () => {
      const props = { ...makeValidProps(), name: '' };
      expect(() => new CloudFile(props)).toThrow(DomainValidationError);
      expect(() => new CloudFile(props)).toThrow('name is required');
    });

    it('throws DomainValidationError when mimeType is empty', () => {
      const props = { ...makeValidProps(), mimeType: '' };
      expect(() => new CloudFile(props)).toThrow(DomainValidationError);
      expect(() => new CloudFile(props)).toThrow('mimeType is required');
    });

    it('throws DomainValidationError when modifiedAt is missing', () => {
      const props = { ...makeValidProps(), modifiedAt: undefined as unknown as Date };
      expect(() => new CloudFile(props)).toThrow(DomainValidationError);
      expect(() => new CloudFile(props)).toThrow('modifiedAt is required');
    });
  });

  describe('immutability', () => {
    it('throws when attempting to mutate id at runtime', () => {
      const file = new CloudFile(makeValidProps());
      expect(() => {
        (file as unknown as Record<string, unknown>).id = '999';
      }).toThrow();
    });

    it('throws when attempting to mutate name at runtime', () => {
      const file = new CloudFile(makeValidProps());
      expect(() => {
        (file as unknown as Record<string, unknown>).name = 'new name';
      }).toThrow();
    });

    it('throws when attempting to mutate mimeType at runtime', () => {
      const file = new CloudFile(makeValidProps());
      expect(() => {
        (file as unknown as Record<string, unknown>).mimeType = 'text/plain';
      }).toThrow();
    });

    it('throws when attempting to mutate modifiedAt at runtime', () => {
      const file = new CloudFile(makeValidProps());
      expect(() => {
        (file as unknown as Record<string, unknown>).modifiedAt = new Date();
      }).toThrow();
    });
  });

  describe('equality', () => {
    it('returns true for two files with identical properties', () => {
      const props = makeValidProps();
      const a = new CloudFile(props);
      const b = new CloudFile(props);
      expect(a.equals(b)).toBe(true);
    });

    it('returns false when id differs', () => {
      const a = new CloudFile(makeValidProps());
      const b = new CloudFile({ ...makeValidProps(), id: '999' });
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when name differs', () => {
      const a = new CloudFile(makeValidProps());
      const b = new CloudFile({ ...makeValidProps(), name: 'Other' });
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when mimeType differs', () => {
      const a = new CloudFile(makeValidProps());
      const b = new CloudFile({
        ...makeValidProps(),
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when modifiedAt differs', () => {
      const a = new CloudFile(makeValidProps());
      const b = new CloudFile({
        ...makeValidProps(),
        modifiedAt: new Date('2026-05-20T13:00:00Z'),
      });
      expect(a.equals(b)).toBe(false);
    });
  });
});
