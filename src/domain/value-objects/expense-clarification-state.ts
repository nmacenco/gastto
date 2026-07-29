// LAYER: Domain
// Typed state payload for the EXPENSE_CLARIFYING FSM state.
// Replaces the previous Record<string, unknown> bag with a validated,
// immutable value object that is safe to serialize to JSONB.

import type { ExtractedExpense, CategoryConfidence } from '../entities/ExpenseRecord';
import type { Currency } from '../entities/User';
import { DomainValidationError } from '../errors/DomainValidationError';

export type MissingClarificationField = 'monto' | 'moneda';

const VALID_CONFIDENCE: CategoryConfidence[] = ['alta', 'baja', 'nula'];
const VALID_CURRENCIES: Currency[] = ['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL'];

export class ExpenseClarificationState {
  private constructor(
    public readonly missingField: MissingClarificationField,
    public readonly partialExtracted: ExtractedExpense,
    public readonly rawMessage: string,
  ) {
    Object.freeze(this);
    Object.freeze(this.partialExtracted);
  }

  static create(
    missingField: MissingClarificationField,
    partialExtracted: ExtractedExpense,
    rawMessage: string,
  ): ExpenseClarificationState {
    ExpenseClarificationState.validateMissingField(missingField);
    ExpenseClarificationState.validatePartialExtracted(partialExtracted);
    ExpenseClarificationState.validateRawMessage(rawMessage);

    return new ExpenseClarificationState(missingField, partialExtracted, rawMessage);
  }

  static fromPayload(payload: unknown): ExpenseClarificationState {
    if (!isPlainObject(payload)) {
      throw new DomainValidationError('ExpenseClarificationState payload must be an object');
    }

    const missingField = payload.missingField;
    const rawMessage = payload.rawMessage;
    const partialExtracted = payload.partialExtracted;

    ExpenseClarificationState.validateMissingField(missingField);
    ExpenseClarificationState.validateRawMessage(rawMessage);
    ExpenseClarificationState.validatePartialExtracted(partialExtracted);

    return new ExpenseClarificationState(missingField, partialExtracted, rawMessage);
  }

  toPayload(): Record<string, unknown> {
    return {
      _type: 'ExpenseClarificationState',
      missingField: this.missingField,
      partialExtracted: this.partialExtracted,
      rawMessage: this.rawMessage,
    };
  }

  private static validateMissingField(value: unknown): asserts value is MissingClarificationField {
    if (value !== 'monto' && value !== 'moneda') {
      throw new DomainValidationError(
        `missingField must be 'monto' or 'moneda', received: ${String(value)}`,
      );
    }
  }

  private static validateRawMessage(value: unknown): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new DomainValidationError('rawMessage must be a non-empty string');
    }
  }

  private static validatePartialExtracted(value: unknown): asserts value is ExtractedExpense {
    if (!isPlainObject(value)) {
      throw new DomainValidationError('partialExtracted must be an object');
    }

    const { monto, moneda, categoriaRaw, fechaRaw, medioPago, confianzaCategoria } = value;

    if (monto !== null && (typeof monto !== 'number' || !Number.isFinite(monto))) {
      throw new DomainValidationError('partialExtracted.monto must be a finite number or null');
    }

    if (moneda !== null && !VALID_CURRENCIES.some((currency) => currency === moneda)) {
      const monedaValue = typeof moneda === 'string' ? moneda : JSON.stringify(moneda);
      throw new DomainValidationError(
        `partialExtracted.moneda must be a valid currency or null, received: ${monedaValue}`,
      );
    }

    if (categoriaRaw !== null && typeof categoriaRaw !== 'string') {
      throw new DomainValidationError('partialExtracted.categoriaRaw must be a string or null');
    }

    if (fechaRaw !== null && typeof fechaRaw !== 'string') {
      throw new DomainValidationError('partialExtracted.fechaRaw must be a string or null');
    }

    if (medioPago !== null && typeof medioPago !== 'string') {
      throw new DomainValidationError('partialExtracted.medioPago must be a string or null');
    }

    if (!VALID_CONFIDENCE.includes(confianzaCategoria as CategoryConfidence)) {
      throw new DomainValidationError(
        `partialExtracted.confianzaCategoria must be one of ${VALID_CONFIDENCE.join(', ')}, received: ${String(confianzaCategoria)}`,
      );
    }
  }
}

export function isExpenseClarificationState(
  payload: unknown,
): payload is ExpenseClarificationState {
  if (!isPlainObject(payload)) {
    return false;
  }

  if (payload._type !== 'ExpenseClarificationState') {
    return false;
  }

  const missingField = payload.missingField;
  if (missingField !== 'monto' && missingField !== 'moneda') {
    return false;
  }

  if (typeof payload.rawMessage !== 'string' || payload.rawMessage.trim().length === 0) {
    return false;
  }

  return isPlainExtractedExpense(payload.partialExtracted);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
