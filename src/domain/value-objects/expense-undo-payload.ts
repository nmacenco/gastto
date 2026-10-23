// LAYER: Domain
// Payload persisted exclusively while the FSM is EXPENSE_UNDO_CONFIRMING.

import { DomainValidationError } from '../errors/DomainValidationError';
import {
  normalizeFinancialActionBinding,
  type FinancialActionBinding,
} from './financial-action-binding';

export interface ExpenseUndoPayload {
  pendingExpenseId: string;
  actionBinding: FinancialActionBinding | null;
}

export function parseExpenseUndoPayload(payload: unknown): ExpenseUndoPayload | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.pendingExpenseId !== 'string' || value.pendingExpenseId.length === 0)
    return null;

  if (value.actionBinding === undefined) {
    return { pendingExpenseId: value.pendingExpenseId, actionBinding: null };
  }
  try {
    return {
      pendingExpenseId: value.pendingExpenseId,
      actionBinding: normalizeFinancialActionBinding(value.actionBinding),
    };
  } catch (error) {
    if (error instanceof DomainValidationError) return null;
    throw error;
  }
}
