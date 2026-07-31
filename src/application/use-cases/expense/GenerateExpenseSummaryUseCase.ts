// LAYER: Application
// Use case: builds a channel-agnostic expense summary from the review payload
// and delegates its presentation to the injected presenter.

import type { ExpenseSummary } from '../../dtos/expense-summary.dto';
import type { ExpenseSummaryPresenter } from '../../ports/output/expense-summary.presenter';
import type { IExpenseRecordRepository } from '../../../domain/ports/repositories';
import type { ExpenseReviewPayload } from './RegisterExpense';

export interface GenerateExpenseSummaryInput {
  userId: string;
  payload: ExpenseReviewPayload;
  presenter: ExpenseSummaryPresenter;
}

export class GenerateExpenseSummaryUseCase {
  constructor(
    private readonly expenseRepo: IExpenseRecordRepository,
    private readonly highAmountThresholdMultiplier: number = 10,
  ) {}

  async execute(input: GenerateExpenseSummaryInput): Promise<void> {
    const summary = await this.buildSummary(input.userId, input.payload);
    await input.presenter.presentSummary(summary);
  }

  private async buildSummary(
    userId: string,
    payload: ExpenseReviewPayload,
  ): Promise<ExpenseSummary> {
    const date = payload.extracted.fechaRaw ? payload.resolvedDate : 'today';
    const amount = payload.extracted.monto ?? 0;
    const averageAmount = await this.expenseRepo.findAverageAmountByUserId(userId);
    const isHighAmount =
      averageAmount !== null && amount > averageAmount * this.highAmountThresholdMultiplier;

    return {
      concept: payload.rawMessage,
      amount,
      currency: payload.extracted.moneda ?? '',
      category: payload.resolvedCategory ?? '',
      date,
      categoryConfidence: payload.extracted.confianzaCategoria,
      categoryStatus: payload.categoryStatus,
      actions: {
        confirm: true,
        correct: true,
        cancel: true,
      },
      isHighAmount,
      requiresExplicitConfirmation: isHighAmount,
    };
  }
}
