// LAYER: Domain
// Payload shape for the EXPENSE_REVIEW FSM state.
// Defined in the Domain layer so it can be reused by Domain value objects
// (e.g. ExpenseCorrectionState) and by Application/Interface layers without
// violating the Clean Architecture dependency rule.

import type { ExtractedExpense } from '../entities/ExpenseRecord';

export interface ExpenseReviewPayload {
  extracted: ExtractedExpense;
  rawMessage: string;
  resolvedDate: string; // ISO date string
  resolvedCategory: string | null;
  resolvedCategoryId: string | null;
  categoryStatus: 'confirmed' | 'ambiguous' | 'fallback' | 'none';
  awaitingZeroConfirmation?: boolean;
  reminderSent?: boolean;
  pendingHighAmountConfirmation?: boolean;
}

export type ExpenseReviewCategoryStatus = ExpenseReviewPayload['categoryStatus'];
