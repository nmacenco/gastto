// LAYER: Domain
// Typed state payload for the EXPENSE_CORRECTING FSM state.
// Replaces the previous Record<string, unknown> bag with a validated,
// immutable value object that is safe to serialize to JSONB.

import {
  normalizeExpenseReviewPayload,
  tryNormalizeExpenseReviewPayload,
  type ExpenseReviewPayload,
} from './expense-review-payload';
import { DomainValidationError } from '../errors/DomainValidationError';

export const MAX_CORRECTION_CYCLES = 5;

export class ExpenseCorrectionState {
  private constructor(
    public readonly payload: ExpenseReviewPayload,
    public readonly correctionCycles: number,
    public readonly pendingHighAmountConfirmation: boolean,
  ) {
    Object.freeze(this);
    Object.freeze(this.payload);
    Object.freeze(this.payload.extracted);
  }

  static create(
    payload: ExpenseReviewPayload,
    correctionCycles: number = 0,
    pendingHighAmountConfirmation: boolean = false,
  ): ExpenseCorrectionState {
    const normalizedPayload = normalizeExpenseReviewPayload(payload);
    ExpenseCorrectionState.validateCorrectionCycles(correctionCycles);

    return new ExpenseCorrectionState(
      normalizedPayload,
      correctionCycles,
      pendingHighAmountConfirmation,
    );
  }

  static fromPayload(payload: unknown): ExpenseCorrectionState {
    if (!isPlainObject(payload)) {
      throw new DomainValidationError('ExpenseCorrectionState payload must be an object');
    }

    if (payload._type !== 'ExpenseCorrectionState') {
      throw new DomainValidationError('ExpenseCorrectionState payload has an invalid type marker');
    }

    const reviewPayload = normalizeExpenseReviewPayload(payload.payload);
    const correctionCycles = payload.correctionCycles;
    const pendingHighAmountConfirmation = payload.pendingHighAmountConfirmation;

    ExpenseCorrectionState.validateCorrectionCycles(correctionCycles);

    if (
      pendingHighAmountConfirmation !== undefined &&
      typeof pendingHighAmountConfirmation !== 'boolean'
    ) {
      throw new DomainValidationError(
        'pendingHighAmountConfirmation must be a boolean when provided',
      );
    }

    return new ExpenseCorrectionState(
      reviewPayload,
      correctionCycles,
      pendingHighAmountConfirmation === true,
    );
  }

  toPayload(): Record<string, unknown> {
    return {
      _type: 'ExpenseCorrectionState',
      payload: this.payload,
      correctionCycles: this.correctionCycles,
      pendingHighAmountConfirmation: this.pendingHighAmountConfirmation,
    };
  }

  /**
   * Returns a new state with the review payload updated and the correction
   * cycle counter incremented by one.
   */
  next(updatedPayload: ExpenseReviewPayload): ExpenseCorrectionState {
    return ExpenseCorrectionState.create(updatedPayload, this.correctionCycles + 1);
  }

  private static validateCorrectionCycles(value: unknown): asserts value is number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new DomainValidationError(
        `correctionCycles must be a non-negative integer, received: ${String(value)}`,
      );
    }
  }
}

export function isExpenseCorrectionState(payload: unknown): payload is ExpenseCorrectionState {
  if (!isPlainObject(payload)) {
    return false;
  }

  if (payload._type !== 'ExpenseCorrectionState') {
    return false;
  }

  if (
    typeof payload.correctionCycles !== 'number' ||
    !Number.isInteger(payload.correctionCycles) ||
    payload.correctionCycles < 0
  ) {
    return false;
  }

  if (
    payload.pendingHighAmountConfirmation !== undefined &&
    typeof payload.pendingHighAmountConfirmation !== 'boolean'
  ) {
    return false;
  }

  return tryNormalizeExpenseReviewPayload(payload.payload) !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
