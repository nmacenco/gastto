// LAYER: Domain / Tests
// Unit tests for the Money value object.

import { describe, it, expect } from 'vitest';
import { Money } from './Money';
import { DomainValidationError } from '../errors/DomainValidationError';

describe('Money', () => {
  describe('construction', () => {
    it('creates a Money value object with amount and currency', () => {
      const money = new Money(12.5, 'EUR');
      expect(money.amount).toBe(12.5);
      expect(money.currency).toBe('EUR');
    });

    it('allows zero as a valid amount', () => {
      const money = new Money(0, 'ARS');
      expect(money.amount).toBe(0);
      expect(money.currency).toBe('ARS');
    });
  });

  describe('validation', () => {
    it('throws DomainValidationError when amount is negative', () => {
      expect(() => new Money(-1, 'USD')).toThrow(DomainValidationError);
      expect(() => new Money(-1, 'USD')).toThrow('amount must be non-negative');
    });

    it('throws DomainValidationError when amount is NaN', () => {
      expect(() => new Money(Number.NaN, 'USD')).toThrow(DomainValidationError);
      expect(() => new Money(Number.NaN, 'USD')).toThrow('amount must be a finite number');
    });

    it('throws DomainValidationError when amount is Infinity', () => {
      expect(() => new Money(Number.POSITIVE_INFINITY, 'USD')).toThrow(DomainValidationError);
    });

    it('throws DomainValidationError when amount is -Infinity', () => {
      expect(() => new Money(Number.NEGATIVE_INFINITY, 'USD')).toThrow(DomainValidationError);
    });
  });

  describe('immutability', () => {
    it('throws when attempting to mutate amount at runtime', () => {
      const money = new Money(100, 'USD');
      expect(() => {
        (money as unknown as Record<string, unknown>).amount = 200;
      }).toThrow();
    });

    it('throws when attempting to mutate currency at runtime', () => {
      const money = new Money(100, 'USD');
      expect(() => {
        (money as unknown as Record<string, unknown>).currency = 'EUR';
      }).toThrow();
    });
  });

  describe('equality', () => {
    it('returns true for equal amounts and currencies', () => {
      const a = new Money(42, 'MXN');
      const b = new Money(42, 'MXN');
      expect(a.equals(b)).toBe(true);
    });

    it('returns false when amounts differ', () => {
      const a = new Money(42, 'MXN');
      const b = new Money(43, 'MXN');
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when currencies differ', () => {
      const a = new Money(42, 'USD');
      const b = new Money(42, 'EUR');
      expect(a.equals(b)).toBe(false);
    });
  });
});
