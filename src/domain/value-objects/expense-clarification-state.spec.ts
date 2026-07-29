// LAYER: Domain / Tests
// Unit tests for ExpenseClarificationState value object.

import { describe, it, expect } from 'vitest';
import {
  ExpenseClarificationState,
  isExpenseClarificationState,
} from './expense-clarification-state';
import type { ExtractedExpense } from '../entities/ExpenseRecord';

function buildExtractedExpense(overrides: Partial<ExtractedExpense> = {}): ExtractedExpense {
  return {
    monto: 100,
    moneda: 'EUR',
    categoriaRaw: 'café',
    fechaRaw: '2026-07-25',
    medioPago: null,
    confianzaCategoria: 'alta',
    ...overrides,
  };
}

describe('ExpenseClarificationState', () => {
  describe('create()', () => {
    it('creates an immutable state for missing amount', () => {
      const partial = buildExtractedExpense({ monto: null });
      const state = ExpenseClarificationState.create('monto', partial, 'Pagué el café');

      expect(state.missingField).toBe('monto');
      expect(state.partialExtracted).toEqual(partial);
      expect(state.rawMessage).toBe('Pagué el café');
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.partialExtracted)).toBe(true);
    });

    it('creates an immutable state for missing currency', () => {
      const partial = buildExtractedExpense({ moneda: null });
      const state = ExpenseClarificationState.create('moneda', partial, 'Gasté 100');

      expect(state.missingField).toBe('moneda');
      expect(state.partialExtracted).toEqual(partial);
      expect(state.rawMessage).toBe('Gasté 100');
    });

    it('throws when missingField is invalid', () => {
      const partial = buildExtractedExpense();
      expect(() =>
        ExpenseClarificationState.create('categoria' as 'monto', partial, 'message'),
      ).toThrow();
    });

    it('throws when rawMessage is empty', () => {
      const partial = buildExtractedExpense();
      expect(() => ExpenseClarificationState.create('monto', partial, '   ')).toThrow();
    });

    it('throws when partialExtracted is not an object', () => {
      expect(() =>
        ExpenseClarificationState.create('monto', null as unknown as ExtractedExpense, 'message'),
      ).toThrow();
    });

    it('throws when monto is not a finite number or null', () => {
      const partial = buildExtractedExpense({ monto: Number.NaN });
      expect(() => ExpenseClarificationState.create('monto', partial, 'message')).toThrow();
    });

    it('throws when moneda is not a valid currency or null', () => {
      const partial = buildExtractedExpense({ moneda: 'XYZ' as 'EUR' });
      expect(() => ExpenseClarificationState.create('moneda', partial, 'message')).toThrow();
    });

    it('throws when confianzaCategoria is invalid', () => {
      const partial = buildExtractedExpense({ confianzaCategoria: 'media' as 'alta' });
      expect(() => ExpenseClarificationState.create('monto', partial, 'message')).toThrow();
    });
  });

  describe('toPayload()', () => {
    it('serializes to a plain object', () => {
      const partial = buildExtractedExpense({ monto: null });
      const state = ExpenseClarificationState.create('monto', partial, 'Pagué el café');
      const payload = state.toPayload();

      expect(payload).toEqual({
        _type: 'ExpenseClarificationState',
        missingField: 'monto',
        partialExtracted: partial,
        rawMessage: 'Pagué el café',
      });
    });
  });

  describe('fromPayload()', () => {
    it('reconstructs from a valid payload', () => {
      const partial = buildExtractedExpense({ moneda: null });
      const payload = {
        _type: 'ExpenseClarificationState',
        missingField: 'moneda',
        partialExtracted: partial,
        rawMessage: 'Gasté 100',
      };

      const state = ExpenseClarificationState.fromPayload(payload);

      expect(state.missingField).toBe('moneda');
      expect(state.partialExtracted).toEqual(partial);
      expect(state.rawMessage).toBe('Gasté 100');
    });

    it('throws when payload is not an object', () => {
      expect(() => ExpenseClarificationState.fromPayload(null)).toThrow();
      expect(() => ExpenseClarificationState.fromPayload('invalid')).toThrow();
    });

    it('throws when missingField is missing or invalid', () => {
      const payload = {
        _type: 'ExpenseClarificationState',
        partialExtracted: buildExtractedExpense(),
        rawMessage: 'message',
      };
      expect(() => ExpenseClarificationState.fromPayload(payload)).toThrow();
    });

    it('throws when rawMessage is empty', () => {
      const payload = {
        _type: 'ExpenseClarificationState',
        missingField: 'monto',
        partialExtracted: buildExtractedExpense(),
        rawMessage: '',
      };
      expect(() => ExpenseClarificationState.fromPayload(payload)).toThrow();
    });
  });

  describe('isExpenseClarificationState()', () => {
    it('returns true for a valid payload', () => {
      const payload = {
        _type: 'ExpenseClarificationState',
        missingField: 'monto',
        partialExtracted: buildExtractedExpense({ monto: null }),
        rawMessage: 'message',
      };

      expect(isExpenseClarificationState(payload)).toBe(true);
    });

    it('returns false when _type is missing', () => {
      const payload = {
        missingField: 'monto',
        partialExtracted: buildExtractedExpense(),
        rawMessage: 'message',
      };

      expect(isExpenseClarificationState(payload)).toBe(false);
    });

    it('returns false when missingField is invalid', () => {
      const payload = {
        _type: 'ExpenseClarificationState',
        missingField: 'categoria',
        partialExtracted: buildExtractedExpense(),
        rawMessage: 'message',
      };

      expect(isExpenseClarificationState(payload)).toBe(false);
    });

    it('returns false when partialExtracted is invalid', () => {
      const payload = {
        _type: 'ExpenseClarificationState',
        missingField: 'monto',
        partialExtracted: { ...buildExtractedExpense(), confianzaCategoria: 'media' },
        rawMessage: 'message',
      };

      expect(isExpenseClarificationState(payload)).toBe(false);
    });

    it('returns false for null or non-object values', () => {
      expect(isExpenseClarificationState(null)).toBe(false);
      expect(isExpenseClarificationState('message')).toBe(false);
      expect(isExpenseClarificationState(42)).toBe(false);
    });
  });
});
