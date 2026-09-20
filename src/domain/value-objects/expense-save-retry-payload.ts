// LAYER: Domain
// Payload persisted exclusively while the FSM is EXPENSE_SAVING_RETRY.

import type { SpreadsheetErrorCode } from '../errors/SpreadsheetError';
import { normalizeExpenseReviewPayload, type ExpenseReviewPayload } from './expense-review-payload';
import {
  normalizeFinancialActionBinding,
  type FinancialActionBinding,
} from './financial-action-binding';

export interface ExpenseSaveRetryPayload {
  expense: ExpenseReviewPayload;
  failureCode: SpreadsheetErrorCode;
  firstAttemptAt: string;
  attemptCount: 1;
  actionBinding: FinancialActionBinding | null;
}

export function isExpenseSaveRetryPayload(
  payload: Record<string, unknown> | null,
): payload is ExpenseSaveRetryPayload & Record<string, unknown> {
  return parseExpenseSaveRetryPayload(payload) !== null;
}

export function parseExpenseSaveRetryPayload(payload: unknown): ExpenseSaveRetryPayload | null {
  if (
    !isPlainObject(payload) ||
    payload.attemptCount !== 1 ||
    typeof payload.firstAttemptAt !== 'string'
  ) {
    return null;
  }

  if (Number.isNaN(Date.parse(payload.firstAttemptAt))) {
    return null;
  }

  if (
    payload.failureCode !== 'NETWORK_ERROR' &&
    payload.failureCode !== 'AUTH_ERROR' &&
    payload.failureCode !== 'STRUCTURE_ERROR' &&
    payload.failureCode !== 'UNKNOWN'
  ) {
    return null;
  }

  try {
    const actionBinding =
      payload.actionBinding === undefined
        ? null
        : normalizeFinancialActionBinding(payload.actionBinding);
    return {
      expense: normalizeExpenseReviewPayload(payload.expense),
      failureCode: payload.failureCode,
      firstAttemptAt: payload.firstAttemptAt,
      attemptCount: 1,
      actionBinding,
    };
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
