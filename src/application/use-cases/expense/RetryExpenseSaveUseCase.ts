// LAYER: Application
// Performs the single user-initiated retry permitted after an unconfirmed save.

import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { RegisterExpenseUseCase } from './RegisterExpense';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { IOperationLogRepository } from '../../../domain/ports/repositories';
import {
  isExpenseSaveRetryPayload,
  type ExpenseSaveRetryPayload,
} from '../../../domain/value-objects/expense-save-retry-payload';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import { expenseCopies } from '../../copies/expense.copies';

export interface RetryExpenseSaveInput {
  userId: string;
  chatId: string;
  statePayload: Record<string, unknown> | null;
  expiresAt: Date | null;
}

export interface RetryExpenseSaveDeps {
  registerExpense: RegisterExpenseUseCase;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  operationLogRepo: IOperationLogRepository;
}

export class RetryExpenseSaveUseCase {
  constructor(private readonly deps: RetryExpenseSaveDeps) {}

  async execute(input: RetryExpenseSaveInput): Promise<void> {
    const retryPayload = this.validateRetryPayload(input);
    if (!retryPayload) {
      await this.clearExpiredState(input.userId, input.chatId);
      return;
    }

    await this.deps.messagingPort.sendMessage(input.chatId, expenseCopies.saving());
    try {
      const saveResult = await this.deps.registerExpense.save(
        input.userId,
        retryPayload.expense,
        '',
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
    } catch (error) {
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
      await this.deps.transitionState.execute({ userId: input.userId, targetState: 'IDLE' });
      await this.deps.messagingPort.sendMessage(
        input.chatId,
        expenseCopies.saveManualCopyFallback({
          concept: retryPayload.expense.rawMessage,
          amount: retryPayload.expense.extracted.monto!,
          currency: retryPayload.expense.extracted.moneda!,
        }),
      );
    }
  }

  private validateRetryPayload(input: RetryExpenseSaveInput): ExpenseSaveRetryPayload | null {
    if (!isExpenseSaveRetryPayload(input.statePayload) || input.expiresAt === null) {
      return null;
    }

    if (input.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return { ...input.statePayload };
  }

  private async clearExpiredState(userId: string, chatId: string): Promise<void> {
    await this.deps.transitionState.execute({ userId, targetState: 'IDLE', payload: null });
    await this.deps.messagingPort.sendMessage(chatId, expenseCopies.saveRetryExpired());
  }
}
