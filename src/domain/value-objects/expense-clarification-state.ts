// LAYER: Domain
// Typed state payload for the EXPENSE_CLARIFYING FSM state.
// Replaces the previous Record<string, unknown> bag with a validated,
// immutable value object that is safe to serialize to JSONB.

import type { ExtractedExpense } from '../entities/ExpenseRecord';
import { DomainValidationError } from '../errors/DomainValidationError';
import { normalizeExtractedExpensePayload } from './expense-review-payload';

export type MissingClarificationField = 'monto' | 'moneda';

export class ExpenseClarificationState {
  private constructor(
    public readonly missingField: MissingClarificationField,
    public readonly partialExtracted: ExtractedExpense,
    public readonly rawMessage: string,
    public readonly queueRegisteredCount?: number,
  ) {
    Object.freeze(this);
    Object.freeze(this.partialExtracted);
  }

  static create(
    missingField: MissingClarificationField,
    partialExtracted: ExtractedExpense,
    rawMessage: string,
    queueRegisteredCount?: number,
  ): ExpenseClarificationState {
    ExpenseClarificationState.validateMissingField(missingField);
    const normalizedPartialExtracted = normalizeExtractedExpensePayload(partialExtracted);
    ExpenseClarificationState.validateRawMessage(rawMessage);
    ExpenseClarificationState.validateQueueRegisteredCount(queueRegisteredCount);

    return new ExpenseClarificationState(
      missingField,
      normalizedPartialExtracted,
      rawMessage,
      queueRegisteredCount,
    );
  }

  static fromPayload(payload: unknown): ExpenseClarificationState {
    if (!isPlainObject(payload)) {
      throw new DomainValidationError('ExpenseClarificationState payload must be an object');
    }

    const missingField = payload.missingField;
    const rawMessage = payload.rawMessage;
    const partialExtracted = normalizeExtractedExpensePayload(payload.partialExtracted);
    const queueRegisteredCount = payload.queueRegisteredCount;

    ExpenseClarificationState.validateMissingField(missingField);
    ExpenseClarificationState.validateRawMessage(rawMessage);
    ExpenseClarificationState.validateQueueRegisteredCount(queueRegisteredCount);

    return new ExpenseClarificationState(
      missingField,
      partialExtracted,
      rawMessage,
      queueRegisteredCount,
    );
  }

  toPayload(): Record<string, unknown> {
    return {
      _type: 'ExpenseClarificationState',
      missingField: this.missingField,
      partialExtracted: this.partialExtracted,
      rawMessage: this.rawMessage,
      ...(this.queueRegisteredCount === undefined
        ? {}
        : { queueRegisteredCount: this.queueRegisteredCount }),
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

  private static validateQueueRegisteredCount(value: unknown): asserts value is number | undefined {
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    ) {
      throw new DomainValidationError(
        'queueRegisteredCount must be a non-negative integer when provided',
      );
    }
  }
}

export function isExpenseClarificationState(
  payload: unknown,
): payload is ExpenseClarificationState {
  if (!isPlainObject(payload) || payload._type !== 'ExpenseClarificationState') {
    return false;
  }
  try {
    ExpenseClarificationState.fromPayload(payload);
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
