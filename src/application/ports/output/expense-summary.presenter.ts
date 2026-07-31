// LAYER: Application
// Output port for presenting an interpreted expense summary to the user.
// Infrastructure adapters (Telegram, WhatsApp) implement this contract.

import type { ExpenseSummary } from '../../dtos/expense-summary.dto';

export interface ExpenseSummaryPresenter {
  presentSummary(summary: ExpenseSummary): Promise<void>;
  showTimeoutWarning(): Promise<void>;
  notifyCancellation(): Promise<void>;
  requestHighAmountConfirmation(summary: ExpenseSummary): Promise<void>;
}
