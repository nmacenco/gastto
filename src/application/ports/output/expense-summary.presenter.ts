// LAYER: Application
// Output port for presenting an interpreted expense summary to the user.
// Infrastructure adapters (Telegram, WhatsApp) implement this contract.

import type { ExpenseSummary } from '../../dtos/expense-summary.dto';
import type { ExpenseReviewBinding } from '../../../domain/value-objects/expense-review-binding';

export interface ExpenseSummaryPresenter {
  presentSummary(summary: ExpenseSummary, binding: ExpenseReviewBinding): Promise<void>;
  showTimeoutWarning(pendingCount?: number): Promise<void>;
  notifyCancellation(): Promise<void>;
  requestHighAmountConfirmation(
    summary: ExpenseSummary,
    binding: ExpenseReviewBinding,
  ): Promise<void>;
}
