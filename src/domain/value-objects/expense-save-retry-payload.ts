// LAYER: Domain
// Payload persisted exclusively while the FSM is EXPENSE_SAVING_RETRY.

import type { SpreadsheetErrorCode } from '../errors/SpreadsheetError';
import type { ExpenseReviewPayload } from './expense-review-payload';

export interface ExpenseSaveRetryPayload {
  expense: ExpenseReviewPayload;
  failureCode: SpreadsheetErrorCode;
  firstAttemptAt: string;
  attemptCount: 1;
}

export function isExpenseSaveRetryPayload(
  payload: Record<string, unknown> | null,
): payload is ExpenseSaveRetryPayload & Record<string, unknown> {
  if (payload === null || payload.attemptCount !== 1 || typeof payload.firstAttemptAt !== 'string') {
    return false;
  }

  if (Number.isNaN(Date.parse(payload.firstAttemptAt))) {
    return false;
  }

  if (
    payload.failureCode !== 'NETWORK_ERROR' &&
    payload.failureCode !== 'AUTH_ERROR' &&
    payload.failureCode !== 'STRUCTURE_ERROR' &&
    payload.failureCode !== 'UNKNOWN'
  ) {
    return false;
  }

  const expense = payload.expense;
  return (
    typeof expense === 'object' &&
    expense !== null &&
    typeof (expense as Record<string, unknown>).rawMessage === 'string' &&
    (expense as Record<string, unknown>).extracted !== undefined
  );
}
