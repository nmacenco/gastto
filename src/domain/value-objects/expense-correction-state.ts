// LAYER: Domain
// Typed state payload for the EXPENSE_CORRECTING FSM state.
// Replaces the previous Record<string, unknown> bag with a validated,
// immutable value object that is safe to serialize to JSONB.

import type { ExpenseReviewPayload } from './expense-review-payload';
import type { ExtractedExpense, CategoryConfidence } from '../entities/ExpenseRecord';
import type { Currency } from '../entities/User';
import { DomainValidationError } from '../errors/DomainValidationError';

export const MAX_CORRECTION_CYCLES = 5;

const VALID_CONFIDENCE: CategoryConfidence[] = ['alta', 'baja', 'nula'];
const VALID_CURRENCIES: Currency[] = ['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL'];
const VALID_CATEGORY_STATUS: ExpenseReviewPayload['categoryStatus'][] = [
  'confirmed',
  'ambiguous',
  'fallback',
  'none',
];

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
    ExpenseCorrectionState.validatePayload(payload);
    ExpenseCorrectionState.validateCorrectionCycles(correctionCycles);

    return new ExpenseCorrectionState(payload, correctionCycles, pendingHighAmountConfirmation);
  }

  static fromPayload(payload: unknown): ExpenseCorrectionState {
    if (!isPlainObject(payload)) {
      throw new DomainValidationError('ExpenseCorrectionState payload must be an object');
    }

    if (payload._type !== 'ExpenseCorrectionState') {
      throw new DomainValidationError('ExpenseCorrectionState payload has an invalid type marker');
    }

    const reviewPayload = payload.payload;
    const correctionCycles = payload.correctionCycles;
    const pendingHighAmountConfirmation = payload.pendingHighAmountConfirmation;

    ExpenseCorrectionState.validatePayload(reviewPayload);
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

  private static validatePayload(value: unknown): asserts value is ExpenseReviewPayload {
    if (!isPlainObject(value)) {
      throw new DomainValidationError('payload must be an object');
    }

    const {
      extracted,
      rawMessage,
      resolvedDate,
      resolvedCategory,
      resolvedCategoryId,
      categoryStatus,
      awaitingZeroConfirmation,
      reminderSent,
      pendingHighAmountConfirmation,
    } = value;

    ExpenseCorrectionState.validateExtractedExpense(extracted);

    if (awaitingZeroConfirmation !== undefined && typeof awaitingZeroConfirmation !== 'boolean') {
      throw new DomainValidationError(
        'payload.awaitingZeroConfirmation must be a boolean when provided',
      );
    }

    if (reminderSent !== undefined && typeof reminderSent !== 'boolean') {
      throw new DomainValidationError('payload.reminderSent must be a boolean when provided');
    }

    if (
      pendingHighAmountConfirmation !== undefined &&
      typeof pendingHighAmountConfirmation !== 'boolean'
    ) {
      throw new DomainValidationError(
        'payload.pendingHighAmountConfirmation must be a boolean when provided',
      );
    }

    if (typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
      throw new DomainValidationError('payload.rawMessage must be a non-empty string');
    }

    if (typeof resolvedDate !== 'string' || resolvedDate.trim().length === 0) {
      throw new DomainValidationError('payload.resolvedDate must be a non-empty string');
    }

    if (resolvedCategory !== null && typeof resolvedCategory !== 'string') {
      throw new DomainValidationError('payload.resolvedCategory must be a string or null');
    }

    if (resolvedCategoryId !== null && typeof resolvedCategoryId !== 'string') {
      throw new DomainValidationError('payload.resolvedCategoryId must be a string or null');
    }

    if (!VALID_CATEGORY_STATUS.includes(categoryStatus as ExpenseReviewPayload['categoryStatus'])) {
      throw new DomainValidationError(
        `payload.categoryStatus must be one of ${VALID_CATEGORY_STATUS.join(', ')}, received: ${String(categoryStatus)}`,
      );
    }
  }

  private static validateExtractedExpense(value: unknown): asserts value is ExtractedExpense {
    if (!isPlainObject(value)) {
      throw new DomainValidationError('payload.extracted must be an object');
    }

    const { monto, moneda, categoriaRaw, fechaRaw, medioPago, confianzaCategoria } = value;

    if (monto !== null && (typeof monto !== 'number' || !Number.isFinite(monto))) {
      throw new DomainValidationError('payload.extracted.monto must be a finite number or null');
    }

    if (moneda !== null && !VALID_CURRENCIES.some((currency) => currency === moneda)) {
      const monedaValue = typeof moneda === 'string' ? moneda : JSON.stringify(moneda);
      throw new DomainValidationError(
        `payload.extracted.moneda must be a valid currency or null, received: ${monedaValue}`,
      );
    }

    if (categoriaRaw !== null && typeof categoriaRaw !== 'string') {
      throw new DomainValidationError('payload.extracted.categoriaRaw must be a string or null');
    }

    if (fechaRaw !== null && typeof fechaRaw !== 'string') {
      throw new DomainValidationError('payload.extracted.fechaRaw must be a string or null');
    }

    if (medioPago !== null && typeof medioPago !== 'string') {
      throw new DomainValidationError('payload.extracted.medioPago must be a string or null');
    }

    if (!VALID_CONFIDENCE.includes(confianzaCategoria as CategoryConfidence)) {
      throw new DomainValidationError(
        `payload.extracted.confianzaCategoria must be one of ${VALID_CONFIDENCE.join(', ')}, received: ${String(confianzaCategoria)}`,
      );
    }
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

  return isValidExpenseReviewPayload(payload.payload);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidExpenseReviewPayload(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }

  const {
    extracted,
    rawMessage,
    resolvedDate,
    resolvedCategory,
    resolvedCategoryId,
    categoryStatus,
    awaitingZeroConfirmation,
    reminderSent,
    pendingHighAmountConfirmation,
  } = value;

  if (!isPlainExtractedExpense(extracted)) {
    return false;
  }

  if (
    (awaitingZeroConfirmation !== undefined && typeof awaitingZeroConfirmation !== 'boolean') ||
    (reminderSent !== undefined && typeof reminderSent !== 'boolean') ||
    (pendingHighAmountConfirmation !== undefined &&
      typeof pendingHighAmountConfirmation !== 'boolean')
  ) {
    return false;
  }

  if (typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
    return false;
  }

  if (typeof resolvedDate !== 'string' || resolvedDate.trim().length === 0) {
    return false;
  }

  if (resolvedCategory !== null && typeof resolvedCategory !== 'string') {
    return false;
  }

  if (resolvedCategoryId !== null && typeof resolvedCategoryId !== 'string') {
    return false;
  }

  return VALID_CATEGORY_STATUS.includes(categoryStatus as ExpenseReviewPayload['categoryStatus']);
}

function isPlainExtractedExpense(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }

  const { monto, moneda, categoriaRaw, fechaRaw, medioPago, confianzaCategoria } = value;

  if (monto !== null && (typeof monto !== 'number' || !Number.isFinite(monto))) {
    return false;
  }

  if (moneda !== null && !VALID_CURRENCIES.includes(moneda as Currency)) {
    return false;
  }

  if (categoriaRaw !== null && typeof categoriaRaw !== 'string') {
    return false;
  }

  if (fechaRaw !== null && typeof fechaRaw !== 'string') {
    return false;
  }

  if (medioPago !== null && typeof medioPago !== 'string') {
    return false;
  }

  return VALID_CONFIDENCE.includes(confianzaCategoria as CategoryConfidence);
}
