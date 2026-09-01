// LAYER: Application
// Resolves a text reply received while an expense is awaiting review.

import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import { isCancelIntent, isConfirmIntent } from '../../utils/intents';
import type { CorrectExpenseOutcome, CorrectExpenseUseCase } from './CorrectExpenseUseCase';
import type { QueuePendingExpense } from './QueuePendingExpense';
import type { ResolveExpenseSummaryActionUseCase } from './ResolveExpenseSummaryActionUseCase';
import type { IExpenseQueueRepository } from '../../../domain/ports/repositories';

export interface ResolveExpenseReviewReplyInput {
  userId: string;
  rawMessage: string;
  payload: ExpenseReviewPayload;
  chatId: string;
  channel: 'telegram' | 'whatsapp';
}

export type ResolveExpenseReviewReplyOutcome =
  | { status: 'action_handled'; action: 'confirm' | 'cancel' }
  | { status: 'not_interpretable'; pendingCount: number }
  | { status: 'expense_queued'; pendingCount: 1 | 2 }
  | { status: 'queue_full'; pendingCount: 2 }
  | Exclude<CorrectExpenseOutcome, { status: 'new_expense' } | { status: 'not_interpretable' }>;

export interface ResolveExpenseReviewReplyUseCaseDeps {
  resolveExpenseSummaryAction: ResolveExpenseSummaryActionUseCase;
  correctExpense: CorrectExpenseUseCase;
  queuePendingExpense: QueuePendingExpense;
  expenseQueueRepository: IExpenseQueueRepository;
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
        channel: input.channel,
      });
      return { status: 'action_handled', action: 'confirm' };
    }

    if (isCancelIntent(input.rawMessage)) {
      await this.deps.resolveExpenseSummaryAction.execute({
        userId: input.userId,
        action: 'cancel',
        payload: input.payload,
        chatId: input.chatId,
        channel: input.channel,
        cancellationSource: 'text',
      });
      return { status: 'action_handled', action: 'cancel' };
    }

    const state = ExpenseCorrectionState.create(
      input.payload,
      0,
      input.payload.pendingHighAmountConfirmation === true,
    );
    const outcome = await this.deps.correctExpense.execute({
      userId: input.userId,
      rawMessage: input.rawMessage,
      state,
      channel: input.channel,
    });
    if (outcome.status === 'new_expense') {
      const queueOutcome = await this.deps.queuePendingExpense.execute({
        userId: input.userId,
        rawMessage: input.rawMessage,
        channel: input.channel,
      });
      return queueOutcome.status === 'queued'
        ? { status: 'expense_queued', pendingCount: queueOutcome.pendingCount }
        : { status: 'queue_full', pendingCount: queueOutcome.pendingCount };
    }
    if (outcome.status === 'not_interpretable') {
      return {
        status: 'not_interpretable',
        pendingCount: await this.deps.expenseQueueRepository.countByUserId(input.userId),
      };
    }
    return outcome;
  }
}
