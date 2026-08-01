// LAYER: Domain / Tests
// Unit tests for ExpenseCorrectionState value object.

import { describe, it, expect } from 'vitest';
import {
  ExpenseCorrectionState,
  isExpenseCorrectionState,
  MAX_CORRECTION_CYCLES,
} from './expense-correction-state';
import type { ExpenseReviewPayload } from './expense-review-payload';
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

function buildReviewPayload(overrides: Partial<ExpenseReviewPayload> = {}): ExpenseReviewPayload {
  return {
    extracted: buildExtractedExpense(),
    rawMessage: 'Cafe 12 EUR',
    resolvedDate: '2026-07-25',
    resolvedCategory: 'Comida',
    resolvedCategoryId: null,
    categoryStatus: 'confirmed',
    ...overrides,
  };
}

describe('ExpenseCorrectionState', () => {
  describe('create()', () => {
    it('creates an immutable state with default cycle count and no high-amount flag', () => {
      const payload = buildReviewPayload();
      const state = ExpenseCorrectionState.create(payload);

      expect(state.payload).toEqual(payload);
      expect(state.correctionCycles).toBe(0);
      expect(state.pendingHighAmountConfirmation).toBe(false);
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.payload)).toBe(true);
      expect(Object.isFrozen(state.payload.extracted)).toBe(true);
    });

    it('creates an immutable state with custom cycle count and high-amount flag', () => {
      const payload = buildReviewPayload();
      const state = ExpenseCorrectionState.create(payload, 2, true);

      expect(state.correctionCycles).toBe(2);
      expect(state.pendingHighAmountConfirmation).toBe(true);
    });

    it('exposes the maximum correction cycle count as a named constant', () => {
      expect(MAX_CORRECTION_CYCLES).toBe(5);
    });

    it('throws when payload is not an object', () => {
      expect(() => ExpenseCorrectionState.create(null as unknown as ExpenseReviewPayload)).toThrow(
        'payload must be an object',
      );
    });

    it('throws when extracted expense is invalid', () => {
      const payload = buildReviewPayload({ extracted: { monto: Number.NaN } as ExtractedExpense });
      expect(() => ExpenseCorrectionState.create(payload)).toThrow(
        'payload.extracted.monto must be a finite number or null',
      );
    });

    it('throws when rawMessage is empty', () => {
      const payload = buildReviewPayload({ rawMessage: '   ' });
      expect(() => ExpenseCorrectionState.create(payload)).toThrow(
        'payload.rawMessage must be a non-empty string',
      );
    });

    it('throws when resolvedDate is empty', () => {
      const payload = buildReviewPayload({ resolvedDate: '' });
      expect(() => ExpenseCorrectionState.create(payload)).toThrow(
        'payload.resolvedDate must be a non-empty string',
      );
    });

    it('throws when categoryStatus is invalid', () => {
      const payload = buildReviewPayload({ categoryStatus: 'invalid' as 'confirmed' });
      expect(() => ExpenseCorrectionState.create(payload)).toThrow(
        'payload.categoryStatus must be one of',
      );
    });

    it('throws when correctionCycles is negative', () => {
      const payload = buildReviewPayload();
      expect(() => ExpenseCorrectionState.create(payload, -1)).toThrow(
        'correctionCycles must be a non-negative integer',
      );
    });

    it('throws when correctionCycles is not an integer', () => {
      const payload = buildReviewPayload();
      expect(() => ExpenseCorrectionState.create(payload, 1.5)).toThrow(
        'correctionCycles must be a non-negative integer',
      );
    });
  });

  describe('toPayload()', () => {
    it('serializes to a plain object including the type marker', () => {
      const payload = buildReviewPayload();
      const state = ExpenseCorrectionState.create(payload, 1, true);

      expect(state.toPayload()).toEqual({
        _type: 'ExpenseCorrectionState',
        payload,
        correctionCycles: 1,
        pendingHighAmountConfirmation: true,
      });
    });
  });

  describe('fromPayload()', () => {
    it('reconstructs from a valid payload', () => {
      const payload = buildReviewPayload();
      const serialized = {
        _type: 'ExpenseCorrectionState',
        payload,
        correctionCycles: 2,
        pendingHighAmountConfirmation: true,
      };

      const state = ExpenseCorrectionState.fromPayload(serialized);

      expect(state.payload).toEqual(payload);
      expect(state.correctionCycles).toBe(2);
      expect(state.pendingHighAmountConfirmation).toBe(true);
    });

    it('defaults pendingHighAmountConfirmation to false when omitted', () => {
      const payload = buildReviewPayload();
      const serialized = {
        _type: 'ExpenseCorrectionState',
        payload,
        correctionCycles: 0,
      };

      const state = ExpenseCorrectionState.fromPayload(serialized);

      expect(state.pendingHighAmountConfirmation).toBe(false);
    });

    it('throws when payload is not an object', () => {
      expect(() => ExpenseCorrectionState.fromPayload(null)).toThrow(
        'ExpenseCorrectionState payload must be an object',
      );
    });

    it('throws when review payload is missing', () => {
      expect(() => ExpenseCorrectionState.fromPayload({ _type: 'ExpenseCorrectionState' })).toThrow(
        'payload must be an object',
      );
    });

    it('throws when the type marker is missing or invalid', () => {
      const payload = buildReviewPayload();

      expect(() => ExpenseCorrectionState.fromPayload({ payload, correctionCycles: 0 })).toThrow(
        'invalid type marker',
      );
      expect(() =>
        ExpenseCorrectionState.fromPayload({
          _type: 'OtherState',
          payload,
          correctionCycles: 0,
        }),
      ).toThrow('invalid type marker');
    });

    it('throws when correctionCycles is invalid', () => {
      const payload = buildReviewPayload();
      expect(() =>
        ExpenseCorrectionState.fromPayload({
          _type: 'ExpenseCorrectionState',
          payload,
          correctionCycles: -1,
        }),
      ).toThrow('correctionCycles must be a non-negative integer');
    });

    it('throws when pendingHighAmountConfirmation is not a boolean', () => {
      const payload = buildReviewPayload();
      expect(() =>
        ExpenseCorrectionState.fromPayload({
          _type: 'ExpenseCorrectionState',
          payload,
          correctionCycles: 0,
          pendingHighAmountConfirmation: 'yes',
        }),
      ).toThrow('pendingHighAmountConfirmation must be a boolean when provided');
    });
  });

  describe('next()', () => {
    it('produces a new state with incremented cycle counter', () => {
      const payload = buildReviewPayload();
      const state = ExpenseCorrectionState.create(payload, 0);
      const updatedPayload = buildReviewPayload({
        extracted: buildExtractedExpense({ monto: 150 }),
      });

      const nextState = state.next(updatedPayload);

      expect(nextState.correctionCycles).toBe(1);
      expect(nextState.payload).toEqual(updatedPayload);
      expect(nextState.pendingHighAmountConfirmation).toBe(false);
    });
  });

  describe('isExpenseCorrectionState()', () => {
    it('returns true for a valid payload', () => {
      const payload = buildReviewPayload();
      const serialized = {
        _type: 'ExpenseCorrectionState',
        payload,
        correctionCycles: 0,
      };

      expect(isExpenseCorrectionState(serialized)).toBe(true);
    });

    it('returns false when _type is missing', () => {
      const payload = buildReviewPayload();
      expect(isExpenseCorrectionState({ payload, correctionCycles: 0 })).toBe(false);
    });

    it('returns false when correctionCycles is invalid', () => {
      const payload = buildReviewPayload();
      expect(
        isExpenseCorrectionState({
          _type: 'ExpenseCorrectionState',
          payload,
          correctionCycles: -1,
        }),
      ).toBe(false);
    });

    it('returns false when payload is invalid', () => {
      expect(
        isExpenseCorrectionState({
          _type: 'ExpenseCorrectionState',
          payload: { rawMessage: 'incomplete' },
          correctionCycles: 0,
        }),
      ).toBe(false);
    });

    it('returns false for non-object values', () => {
      expect(isExpenseCorrectionState(null)).toBe(false);
      expect(isExpenseCorrectionState('state')).toBe(false);
      expect(isExpenseCorrectionState(42)).toBe(false);
    });
  });
});
