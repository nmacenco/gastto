// LAYER: Domain
// Strict channel-neutral callback contract for expense review actions.

import { isExpenseReviewOperationId } from './expense-review-binding';

export type ExpenseReviewAction = 'confirm' | 'correct' | 'cancel';

export type ExpenseReviewCallbackData =
  | {
      readonly version: 1;
      readonly action: ExpenseReviewAction;
      readonly operationId: string;
      readonly reviewRevision: number;
    }
  | {
      readonly action: ExpenseReviewAction;
      readonly field?: string | undefined;
    }
  | { readonly invalid: true };

const ACTION_TO_CODE = { confirm: 'c', correct: 'e', cancel: 'x' } as const;
const CODE_TO_ACTION = { c: 'confirm', e: 'correct', x: 'cancel' } as const;

export function encodeExpenseReviewCallback(
  action: ExpenseReviewAction,
  operationId: string,
  reviewRevision: number,
): string {
  if (!isExpenseReviewOperationId(operationId)) throw new Error('Invalid review operation ID');
  if (!Number.isSafeInteger(reviewRevision) || reviewRevision < 1) {
    throw new Error('Invalid review revision');
  }
  return `er1:${ACTION_TO_CODE[action]}:${operationId}:${reviewRevision.toString(36)}`;
}

export function parseExpenseReviewCallback(data: string): ExpenseReviewCallbackData | null {
  if (data.startsWith('er1:')) {
    const parts = data.split(':');
    if (parts.length !== 4) return { invalid: true };
    const action = CODE_TO_ACTION[parts[1] as keyof typeof CODE_TO_ACTION];
    const operationId = parts[2] ?? '';
    const encodedRevision = parts[3] ?? '';
    if (
      !action ||
      !isExpenseReviewOperationId(operationId) ||
      !/^[1-9a-z][0-9a-z]*$/.test(encodedRevision)
    ) {
      return { invalid: true };
    }
    const reviewRevision = Number.parseInt(encodedRevision, 36);
    if (!Number.isSafeInteger(reviewRevision) || reviewRevision < 1) return { invalid: true };
    return { version: 1, action, operationId, reviewRevision };
  }

  try {
    const parsed = JSON.parse(data) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const keys = Object.keys(value);
    if (
      typeof value.action !== 'string' ||
      !['confirm', 'correct', 'cancel'].includes(value.action) ||
      keys.some((key) => key !== 'action' && key !== 'field') ||
      (value.field !== undefined && typeof value.field !== 'string')
    ) {
      return null;
    }
    return {
      action: value.action as ExpenseReviewAction,
      ...(typeof value.field === 'string' ? { field: value.field } : {}),
    };
  } catch {
    return null;
  }
}
