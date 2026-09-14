// LAYER: Application
// Use case: resolves the action chosen by the user on the interpreted expense
// summary (confirm, correct, cancel). Keeps business logic out of the worker
// and route layers.

import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { RegisterExpenseUseCase } from './RegisterExpense';
import {
  normalizeExpenseReviewPayload,
  type ExpenseReviewPayload,
} from '../../../domain/value-objects/expense-review-payload';
import { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { expenseCopies } from '../../copies/expense.copies';
import type { CancelExpenseRegistrationUseCase } from './CancelExpenseRegistrationUseCase';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import type { IOperationLogRepository } from '../../../domain/ports/repositories';
import type { ExpenseSaveRetryPayload } from '../../../domain/value-objects/expense-save-retry-payload';
import type { AdvancePendingExpense } from './AdvancePendingExpense';
import { randomUUID } from 'node:crypto';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';
import type {
  ExpenseReviewAction,
  ExpenseReviewCallbackData,
} from '../../../domain/value-objects/expense-review-callback';
import {
  advanceExpenseReviewBinding,
  createExpenseReviewBinding,
} from '../../../domain/value-objects/expense-review-binding';
import { getFinancialExecutionClaim } from '../../../domain/entities/ConversationState';

export type ExpenseReviewAuthorizationEvidence =
  | {
      kind: 'callback';
      callbackData: ExpenseReviewCallbackData;
      receivedAt: string;
      sourceMessageId: string;
    }
  | { kind: 'text'; receivedAt: string; sourceMessageId: string };

export type ResolveExpenseSummaryActionOutcome =
  | { status: 'handled'; action: ExpenseReviewAction }
  | { status: 'review_required'; payload: ExpenseReviewPayload }
  | { status: 'stale' | 'expired' | 'unbound' | 'invalid' | 'operation_in_progress' };

export interface ResolveExpenseSummaryActionInput {
  userId: string;
  action?: ExpenseReviewAction;
  /** @deprecated Authorization always reloads the persisted review payload. */
  payload?: ExpenseReviewPayload;
  chatId: string;
  authorization?: ExpenseReviewAuthorizationEvidence;
  cancellationSource?: 'text' | 'callback';
  channel?: 'telegram' | 'whatsapp';
}

export interface ResolveExpenseSummaryActionDeps {
  registerExpense: RegisterExpenseUseCase;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  cancelExpenseRegistration: CancelExpenseRegistrationUseCase;
  operationLogRepo: IOperationLogRepository;
  advancePendingExpense?: AdvancePendingExpense;
}

export class ResolveExpenseSummaryActionUseCase {
  constructor(private readonly deps: ResolveExpenseSummaryActionDeps) {}

  async execute(
    input: ResolveExpenseSummaryActionInput,
  ): Promise<ResolveExpenseSummaryActionOutcome> {
    const authorization = this.authorize(input);
    if (authorization.status !== 'authorized') return authorization;
    const { action, payload } = authorization;

    if (action === 'confirm' && payload.awaitingZeroConfirmation === true) {
      const nextPayload: ExpenseReviewPayload = {
        ...payload,
        awaitingZeroConfirmation: false,
        reviewBinding: advanceExpenseReviewBinding(payload.reviewBinding),
      };
      const state = this.deps.transitionState.currentState(input.userId)!;
      await this.deps.transitionState.execute({
        userId: input.userId,
        targetState: 'EXPENSE_REVIEW',
        payload: nextPayload as unknown as Record<string, unknown>,
        expiresAt: state.expiresAt,
      });
      return { status: 'review_required', payload: nextPayload };
    }

    const authorizedInput = { ...input, action, payload, authorization: input.authorization! };
    switch (action) {
      case 'confirm':
        await this.handleConfirm(authorizedInput);
        break;
      case 'correct':
        await this.handleCorrect(authorizedInput);
        break;
      case 'cancel':
        await this.handleCancel(authorizedInput);
        break;
      /* istanbul ignore next */
      default:
        // Exhaustiveness guard — should never happen at runtime.
        throw new Error(`Unsupported summary action: ${action as string}`);
    }
    return { status: 'handled', action };
  }

  private authorize(
    input: ResolveExpenseSummaryActionInput,
  ):
    | { status: 'authorized'; action: ExpenseReviewAction; payload: ExpenseReviewPayload }
    | Exclude<ResolveExpenseSummaryActionOutcome, { status: 'handled' | 'review_required' }> {
    if (input.authorization === undefined) return { status: 'invalid' };
    const state = this.deps.transitionState.currentState(input.userId);
    if (!state || state.currentState !== 'EXPENSE_REVIEW') return { status: 'stale' };
    if (getFinancialExecutionClaim(state.statePayload) !== null) {
      return { status: 'operation_in_progress' };
    }
    if (state.expiresAt !== null && state.expiresAt.getTime() <= Date.now()) {
      return { status: 'expired' };
    }

    let payload: ExpenseReviewPayload;
    try {
      payload = normalizeExpenseReviewPayload(state.statePayload);
    } catch {
      return { status: 'invalid' };
    }
    const binding = payload.reviewBinding;
    if (binding === null || binding === undefined || binding.presentedAt === null) {
      return { status: 'unbound' };
    }
    const receivedAt = Date.parse(input.authorization.receivedAt);
    if (!Number.isFinite(receivedAt)) return { status: 'invalid' };

    let action = input.action;
    if (input.authorization.kind === 'callback') {
      const callback = input.authorization.callbackData;
      if ('invalid' in callback) return { status: 'invalid' };
      if (!('version' in callback)) return { status: 'unbound' };
      action = callback.action;
      if (
        callback.operationId !== binding.operationId ||
        callback.reviewRevision !== binding.revision
      ) {
        return { status: 'stale' };
      }
    } else if (receivedAt <= Date.parse(binding.presentedAt)) {
      return { status: 'unbound' };
    }
    if (action === undefined) return { status: 'invalid' };
    return { status: 'authorized', action, payload };
  }

  private async handleConfirm(
    input: ResolveExpenseSummaryActionInput & {
      action: ExpenseReviewAction;
      payload: ExpenseReviewPayload;
      authorization: ExpenseReviewAuthorizationEvidence;
    },
  ): Promise<void> {
    const claimId = randomUUID();
    const executionClaim = {
      claimId,
      kind: 'save' as const,
      operationId: input.payload.reviewBinding!.operationId,
      sourceMessageId: input.authorization.sourceMessageId,
      status: 'in_flight' as const,
      target: { expense: input.payload },
    };

    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'EXPENSE_SAVING',
      payload: {
        ...input.payload,
        executionClaim,
      },
      claimId,
    });
    await this.deps.messagingPort.sendMessage(input.chatId, expenseCopies.saving());

    // The third argument is a legacy spreadsheetId placeholder that the current
    // save() implementation does not use; it is kept to preserve the interface.
    let saveResult: { sheetName: string; rowIndex?: number | undefined; expenseId?: string };
    try {
      saveResult = await this.deps.registerExpense.save(input.userId, input.payload, '', claimId);
    } catch (error) {
      await this.handleSaveFailure(input, error, executionClaim);
      return;
    }

    await this.deps.messagingPort.sendMessage(
      input.chatId,
      expenseCopies.expenseSavedConfirmation({
        concept: input.payload.rawMessage,
        amount: input.payload.extracted.monto!,
        currency: input.payload.extracted.moneda!,
        sheetName: saveResult.sheetName,
        ...(saveResult.rowIndex === undefined ? {} : { rowIndex: saveResult.rowIndex }),
      }),
    );
    if (this.deps.advancePendingExpense) {
      const advanceOutcome = await this.deps.advancePendingExpense.execute({
        userId: input.userId,
        chatId: input.chatId,
        channel: input.channel ?? 'telegram',
        reason: 'confirmed',
        completedCount: (input.payload.queueRegisteredCount ?? 0) + 1,
        ...(saveResult.expenseId === undefined
          ? {}
          : { immediateUndoExpenseId: saveResult.expenseId }),
      });
      if (advanceOutcome.status === 'empty' && input.payload.queueRegisteredCount !== undefined) {
        await this.deps.messagingPort.sendMessage(
          input.chatId,
          expenseCopies.expenseQueueClosingSummary(input.payload.queueRegisteredCount + 1),
        );
      }
    }
  }

  private async handleSaveFailure(
    input: ResolveExpenseSummaryActionInput & { payload: ExpenseReviewPayload },
    error: unknown,
    executionClaim: {
      claimId: string;
      kind: 'save';
      operationId: string;
      sourceMessageId: string;
      status: 'in_flight';
      target: { expense: ExpenseReviewPayload };
    },
  ): Promise<void> {
    if (error instanceof StaleConversationStateError) throw error;
    const spreadsheetError =
      error instanceof SpreadsheetError
        ? error
        : new SpreadsheetError('Unexpected expense save failure');
    const { claimId } = executionClaim;

    await this.deps.operationLogRepo.create(
      input.userId,
      'EXPENSE_SAVE_FAILED',
      { failureCode: spreadsheetError.code },
      spreadsheetError.code,
    );

    if (spreadsheetError.outcomeUnknown) {
      await this.deps.transitionState.finalizeClaim({
        userId: input.userId,
        targetState: 'EXPENSE_SAVING',
        payload: {
          ...input.payload,
          executionClaim: { ...executionClaim, status: 'outcome_unknown' },
        },
        claimId,
      });
      await this.deps.messagingPort.sendMessage(
        input.chatId,
        expenseCopies.financialOutcomeUnknown(),
      );
      return;
    }

    if (spreadsheetError.retryable) {
      const retryPayload: ExpenseSaveRetryPayload = {
        expense: input.payload,
        failureCode: spreadsheetError.code,
        firstAttemptAt: new Date().toISOString(),
        attemptCount: 1,
        actionBinding: createExpenseReviewBinding(),
      };
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await this.deps.transitionState.finalizeClaim({
        userId: input.userId,
        targetState: 'EXPENSE_SAVING_RETRY',
        payload: { ...retryPayload },
        expiresAt,
        claimId,
      });
      const delivery = await this.deps.messagingPort.sendMessage(
        input.chatId,
        expenseCopies.saveNetworkFailure(),
      );
      if (delivery.status === 'success') {
        await this.deps.transitionState.execute({
          userId: input.userId,
          targetState: 'EXPENSE_SAVING_RETRY',
          payload: {
            ...retryPayload,
            actionBinding: {
              ...retryPayload.actionBinding!,
              presentedAt: new Date().toISOString(),
            },
          },
          expiresAt,
        });
      }
      return;
    }

    if (spreadsheetError.code === 'AUTH_ERROR') {
      await this.deps.transitionState.finalizeClaim({
        userId: input.userId,
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
        claimId,
      });
    } else {
      await this.deps.transitionState.finalizeClaim({
        userId: input.userId,
        targetState: 'IDLE',
        claimId,
      });
    }
    const copy =
      spreadsheetError.code === 'AUTH_ERROR'
        ? expenseCopies.saveAuthorizationFailure()
        : spreadsheetError.code === 'STRUCTURE_ERROR'
          ? expenseCopies.saveStructureFailure()
          : expenseCopies.saveManualCopyFallback({
              concept: input.payload.rawMessage,
              amount: input.payload.extracted.monto!,
              currency: input.payload.extracted.moneda!,
            });
    await this.deps.messagingPort.sendMessage(input.chatId, copy);
  }

  private async handleCorrect(
    input: ResolveExpenseSummaryActionInput & { payload: ExpenseReviewPayload },
  ): Promise<void> {
    const correctionState = ExpenseCorrectionState.create(input.payload, 0, false);

    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'EXPENSE_CORRECTING',
      payload: correctionState.toPayload(),
    });

    await this.deps.messagingPort.sendMessage(
      input.chatId,
      expenseCopies.expenseCorrectionPrompt(),
    );
  }

  private async handleCancel(
    input: ResolveExpenseSummaryActionInput & { payload: ExpenseReviewPayload },
  ): Promise<void> {
    await this.deps.cancelExpenseRegistration.execute({
      userId: input.userId,
      chatId: input.chatId,
      currentState: 'EXPENSE_REVIEW',
      source: input.cancellationSource ?? 'callback',
      ...(input.channel === undefined ? {} : { channel: input.channel }),
      ...(input.payload.queueRegisteredCount === undefined
        ? {}
        : { completedCount: input.payload.queueRegisteredCount }),
    });
  }
}
