// LAYER: Application
// Resolves a text reply received while an expense is awaiting review.

import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import { isCancelIntent, isConfirmIntent } from '../../utils/intents';
import type { CorrectExpenseOutcome, CorrectExpenseUseCase } from './CorrectExpenseUseCase';
import type { ResolveExpenseSummaryActionUseCase } from './ResolveExpenseSummaryActionUseCase';

export interface ResolveExpenseReviewReplyInput {
  userId: string;
  rawMessage: string;
  payload: ExpenseReviewPayload;
  chatId: string;
  channel: 'telegram' | 'whatsapp';
}

export type ResolveExpenseReviewReplyOutcome =
  | { status: 'action_handled'; action: 'confirm' | 'cancel' }
  | CorrectExpenseOutcome;

export interface ResolveExpenseReviewReplyUseCaseDeps {
  resolveExpenseSummaryAction: ResolveExpenseSummaryActionUseCase;
  correctExpense: CorrectExpenseUseCase;
}

export class ResolveExpenseReviewReplyUseCase {
  constructor(private readonly deps: ResolveExpenseReviewReplyUseCaseDeps) {}

  async execute(input: ResolveExpenseReviewReplyInput): Promise<ResolveExpenseReviewReplyOutcome> {
    if (isConfirmIntent(input.rawMessage)) {
      await this.deps.resolveExpenseSummaryAction.execute({
        userId: input.userId,
        action: 'confirm',
        payload: input.payload,
        chatId: input.chatId,
      });
      return { status: 'action_handled', action: 'confirm' };
    }

    if (isCancelIntent(input.rawMessage)) {
      await this.deps.resolveExpenseSummaryAction.execute({
        userId: input.userId,
        action: 'cancel',
        payload: input.payload,
        chatId: input.chatId,
      });
      return { status: 'action_handled', action: 'cancel' };
    }

    const state = ExpenseCorrectionState.create(
      input.payload,
      0,
      input.payload.pendingHighAmountConfirmation === true,
    );
    return this.deps.correctExpense.execute({
      userId: input.userId,
      rawMessage: input.rawMessage,
      state,
      channel: input.channel,
    });
  }
}
