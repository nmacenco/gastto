// LAYER: Application
// Performs the single user-initiated retry permitted after an unconfirmed save.

import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { RegisterExpenseUseCase } from './RegisterExpense';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { IOperationLogRepository } from '../../../domain/ports/repositories';
import {
  parseExpenseSaveRetryPayload,
  type ExpenseSaveRetryPayload,
} from '../../../domain/value-objects/expense-save-retry-payload';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import { expenseCopies } from '../../copies/expense.copies';
import { randomUUID } from 'node:crypto';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';
import { getFinancialExecutionClaim } from '../../../domain/entities/ConversationState';

export interface RetryExpenseSaveInput {
  userId: string;
  chatId: string;
  authorization: { receivedAt: string; sourceMessageId: string };
}

export type RetryExpenseSaveOutcome =
  | { status: 'handled' }
  | { status: 'stale' | 'expired' | 'unbound' | 'invalid' | 'operation_in_progress' };

export interface RetryExpenseSaveDeps {
  registerExpense: RegisterExpenseUseCase;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  operationLogRepo: IOperationLogRepository;
}

export class RetryExpenseSaveUseCase {
  constructor(private readonly deps: RetryExpenseSaveDeps) {}

  async execute(input: RetryExpenseSaveInput): Promise<RetryExpenseSaveOutcome> {
    const authorization = this.authorize(input);
    if (authorization.status !== 'authorized') return authorization;
    const { retryPayload, expiresAt } = authorization;

    const claimId = randomUUID();
    const executionClaim = {
      claimId,
      kind: 'retry' as const,
      operationId: retryPayload.actionBinding!.operationId,
      sourceMessageId: input.authorization.sourceMessageId,
      status: 'in_flight' as const,
      target: { expense: retryPayload.expense, attemptCount: 2 },
    };
    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'EXPENSE_SAVING_RETRY',
      payload: { ...retryPayload, executionClaim },
      expiresAt,
      claimId,
    });
    await this.deps.messagingPort.sendMessage(input.chatId, expenseCopies.saving());
    try {
      const saveResult = await this.deps.registerExpense.save(
        input.userId,
        retryPayload.expense,
        '',
        claimId,
      );
      await this.deps.messagingPort.sendMessage(
        input.chatId,
        expenseCopies.expenseSavedConfirmation({
          concept: retryPayload.expense.rawMessage,
          amount: retryPayload.expense.extracted.monto!,
          currency: retryPayload.expense.extracted.moneda!,
          sheetName: saveResult.sheetName,
          ...(saveResult.rowIndex === undefined ? {} : { rowIndex: saveResult.rowIndex }),
        }),
      );
      return { status: 'handled' };
    } catch (error) {
      if (error instanceof StaleConversationStateError) throw error;
      const spreadsheetError =
        error instanceof SpreadsheetError
          ? error
          : new SpreadsheetError('Unexpected expense retry failure');
      await this.deps.operationLogRepo.create(
        input.userId,
        'EXPENSE_SAVE_FAILED',
        { failureCode: spreadsheetError.code, attemptCount: 2 },
        spreadsheetError.code,
      );
      if (spreadsheetError.outcomeUnknown) {
        await this.deps.transitionState.finalizeClaim({
          userId: input.userId,
          targetState: 'EXPENSE_SAVING_RETRY',
          payload: {
            ...retryPayload,
            executionClaim: { ...executionClaim, status: 'outcome_unknown' },
          },
          expiresAt,
          claimId,
        });
        await this.deps.messagingPort.sendMessage(
          input.chatId,
          expenseCopies.financialOutcomeUnknown(),
        );
        return { status: 'handled' };
      }
      await this.deps.transitionState.finalizeClaim({
        userId: input.userId,
        targetState: 'IDLE',
        claimId,
      });
      await this.deps.messagingPort.sendMessage(
        input.chatId,
        expenseCopies.saveManualCopyFallback({
          concept: retryPayload.expense.rawMessage,
          amount: retryPayload.expense.extracted.monto!,
          currency: retryPayload.expense.extracted.moneda!,
        }),
      );
      return { status: 'handled' };
    }
  }

  private authorize(
    input: RetryExpenseSaveInput,
  ):
    | { status: 'authorized'; retryPayload: ExpenseSaveRetryPayload; expiresAt: Date }
    | Exclude<RetryExpenseSaveOutcome, { status: 'handled' }> {
    const state = this.deps.transitionState.currentState(input.userId);
    if (!state || state.currentState !== 'EXPENSE_SAVING_RETRY') return { status: 'stale' };
    if (getFinancialExecutionClaim(state.statePayload) !== null) {
      return { status: 'operation_in_progress' };
    }
    if (state.expiresAt === null) return { status: 'invalid' };
    if (state.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
    const retryPayload = parseExpenseSaveRetryPayload(state.statePayload);
    if (!retryPayload) return { status: 'invalid' };
    if (!retryPayload.actionBinding || retryPayload.actionBinding.presentedAt === null) {
      return { status: 'unbound' };
    }
    const receivedAt = Date.parse(input.authorization.receivedAt);
    if (!Number.isFinite(receivedAt)) return { status: 'invalid' };
    if (receivedAt <= Date.parse(retryPayload.actionBinding.presentedAt)) {
      return { status: 'unbound' };
    }
    return { status: 'authorized', retryPayload, expiresAt: state.expiresAt };
  }
}
