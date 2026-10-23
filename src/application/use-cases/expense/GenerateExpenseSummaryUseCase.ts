// LAYER: Application
// Use case: builds a channel-agnostic expense summary from the review payload
// and delegates its presentation to the injected presenter.

import type { ExpenseSummary } from '../../dtos/expense-summary.dto';
import type { ExpenseSummaryPresenter } from '../../ports/output/expense-summary.presenter';
import type { IExpenseRecordRepository } from '../../../domain/ports/repositories';
import {
  normalizeExpenseReviewPayload,
  type ExpenseReviewPayload,
} from '../../../domain/value-objects/expense-review-payload';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import {
  advanceExpenseReviewBinding,
  createExpenseReviewBinding,
} from '../../../domain/value-objects/expense-review-binding';

export interface GenerateExpenseSummaryInput {
  userId: string;
  payload: ExpenseReviewPayload;
  presenter: ExpenseSummaryPresenter;
  forceNewBinding?: boolean;
}

export class GenerateExpenseSummaryUseCase {
  private readonly transitionState: TransitionConversationState | undefined;
  private readonly highAmountThresholdMultiplier: number;

  constructor(
    private readonly expenseRepo: IExpenseRecordRepository,
    transitionStateOrMultiplier?: TransitionConversationState | number,
    highAmountThresholdMultiplier: number = 10,
  ) {
    this.transitionState =
      typeof transitionStateOrMultiplier === 'number' ? undefined : transitionStateOrMultiplier;
    this.highAmountThresholdMultiplier =
      typeof transitionStateOrMultiplier === 'number'
        ? transitionStateOrMultiplier
        : highAmountThresholdMultiplier;
  }

  async execute(input: GenerateExpenseSummaryInput): Promise<ExpenseReviewPayload> {
    let payload = input.payload;
    const state = this.transitionState?.currentState(input.userId);
    if (state?.currentState === 'EXPENSE_REVIEW') {
      const persisted = normalizeExpenseReviewPayload(state.statePayload);
      const binding = input.forceNewBinding
        ? advanceExpenseReviewBinding(persisted.reviewBinding)
        : (persisted.reviewBinding ?? createExpenseReviewBinding());
      payload = { ...persisted, reviewBinding: binding };
      if (persisted.reviewBinding !== binding) {
        await this.transitionState!.execute({
          userId: input.userId,
          targetState: 'EXPENSE_REVIEW',
          payload: payload as unknown as Record<string, unknown>,
          expiresAt: state.expiresAt,
        });
      }
    } else if (payload.reviewBinding === null || payload.reviewBinding === undefined) {
      payload = { ...payload, reviewBinding: createExpenseReviewBinding() };
    }

    const summary = await this.buildSummary(input.userId, payload);
    await input.presenter.presentSummary(summary, payload.reviewBinding!);

    const presentedPayload: ExpenseReviewPayload = {
      ...payload,
      reviewBinding: { ...payload.reviewBinding!, presentedAt: new Date().toISOString() },
    };
    const presentedState = this.transitionState?.currentState(input.userId);
    if (presentedState?.currentState === 'EXPENSE_REVIEW') {
      await this.transitionState!.execute({
        userId: input.userId,
        targetState: 'EXPENSE_REVIEW',
        payload: presentedPayload as unknown as Record<string, unknown>,
        expiresAt: presentedState.expiresAt,
      });
    }
    return presentedPayload;
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
    const subcategoryEnabled = payload.subcategoryEnabled ?? false;

    return {
      concept: payload.rawMessage,
      amount,
      currency: payload.extracted.moneda ?? '',
      category: payload.resolvedCategory ?? '',
      subcategory: subcategoryEnabled ? (payload.resolvedSubcategory ?? '') : '',
      date,
      categoryConfidence: payload.extracted.confianzaCategoria,
      categoryStatus: payload.categoryStatus,
      subcategoryConfidence: payload.extracted.confianzaSubcategoria ?? 'nula',
      subcategoryStatus: payload.subcategoryStatus ?? 'none',
      subcategoryEnabled,
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
