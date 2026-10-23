// LAYER: Domain
// Durable identity for an explicitly presented undo or save-retry authorization.

import {
  advanceExpenseReviewBinding,
  createExpenseReviewBinding,
  normalizeExpenseReviewBinding,
  type ExpenseReviewBinding,
} from './expense-review-binding';

export type FinancialActionBinding = ExpenseReviewBinding;

export const createFinancialActionBinding = createExpenseReviewBinding;
export const advanceFinancialActionBinding = advanceExpenseReviewBinding;
export const normalizeFinancialActionBinding = normalizeExpenseReviewBinding;
