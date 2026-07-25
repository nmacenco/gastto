// LAYER: Domain / Tests
// Unit tests for the Currency value object.

import { describe, it, expect } from 'vitest';
import { Currency } from './Currency';
import { DomainValidationError } from '../errors/DomainValidationError';

describe('Currency', () => {
  describe('construction from ISO codes', () => {
    it.each([
      ['ARS', 'ARS'],
      ['EUR', 'EUR'],
      ['USD', 'USD'],
      ['MXN', 'MXN'],
      ['GBP', 'GBP'],
      ['BRL', 'BRL'],
    ])('normalizes %s to %s', (input, expected) => {
      const currency = new Currency(input);
      expect(currency.code).toBe(expected);
    });

    it('accepts lowercase ISO codes', () => {
      const currency = new Currency('eur');
      expect(currency.code).toBe('EUR');
    });

    it('trims whitespace around ISO codes', () => {
      const currency = new Currency('  USD  ');
      expect(currency.code).toBe('USD');
    });
  });

  describe('construction from symbols', () => {
    it('resolves € to EUR', () => {
      const currency = new Currency('€');
      expect(currency.code).toBe('EUR');
    });

    it('resolves £ to GBP', () => {
      const currency = new Currency('£');
      expect(currency.code).toBe('GBP');
    });
  });

  describe('validation', () => {
    it('throws DomainValidationError for an empty value', () => {
      expect(() => new Currency('')).toThrow(DomainValidationError);
      expect(() => new Currency('   ')).toThrow(DomainValidationError);
    });

    it('throws DomainValidationError for an unsupported ISO code', () => {
      expect(() => new Currency('JPY')).toThrow(DomainValidationError);
    });

    it('throws DomainValidationError for an unknown symbol', () => {
      expect(() => new Currency('¥')).toThrow(DomainValidationError);
    });

    it('throws DomainValidationError for the ambiguous $ symbol', () => {
      expect(() => new Currency('$')).toThrow(DomainValidationError);
    });
  });

  describe('immutability', () => {
    it('throws when attempting to mutate code at runtime', () => {
      const currency = new Currency('USD');
      expect(() => {
        (currency as unknown as Record<string, unknown>).code = 'EUR';
      }).toThrow();
    });
  });

  describe('equality', () => {
    it('returns true for currencies with the same code', () => {
      const a = new Currency('USD');
      const b = new Currency('usd');
      expect(a.equals(b)).toBe(true);
    });

    it('returns false for currencies with different codes', () => {
      const a = new Currency('USD');
      const b = new Currency('EUR');
      expect(a.equals(b)).toBe(false);
    });
  });
});
