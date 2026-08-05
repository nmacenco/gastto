// LAYER: Application
// Use case: resolves the action chosen by the user on the interpreted expense
// summary (confirm, correct, cancel). Keeps business logic out of the worker
// and route layers.

import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { RegisterExpenseUseCase } from './RegisterExpense';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { expenseCopies } from '../../copies/expense.copies';
import type { CancelExpenseRegistrationUseCase } from './CancelExpenseRegistrationUseCase';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import type { IOperationLogRepository } from '../../../domain/ports/repositories';
import type { ExpenseSaveRetryPayload } from '../../../domain/value-objects/expense-save-retry-payload';

export interface ResolveExpenseSummaryActionInput {
  userId: string;
  action: 'confirm' | 'correct' | 'cancel';
  payload: ExpenseReviewPayload;
  chatId: string;
  cancellationSource?: 'text' | 'callback';
}

export interface ResolveExpenseSummaryActionDeps {
  registerExpense: RegisterExpenseUseCase;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  cancelExpenseRegistration: CancelExpenseRegistrationUseCase;
  operationLogRepo: IOperationLogRepository;
}

export class ResolveExpenseSummaryActionUseCase {
  constructor(private readonly deps: ResolveExpenseSummaryActionDeps) {}

  async execute(input: ResolveExpenseSummaryActionInput): Promise<void> {
    switch (input.action) {
      case 'confirm':
        await this.handleConfirm(input);
        break;
      case 'correct':
        await this.handleCorrect(input);
        break;
      case 'cancel':
        await this.handleCancel(input);
        break;
      /* istanbul ignore next */
      default:
        // Exhaustiveness guard — should never happen at runtime.
        throw new Error(`Unsupported summary action: ${input.action as string}`);
    }
  }

  private async handleConfirm(input: ResolveExpenseSummaryActionInput): Promise<void> {
    await this.deps.messagingPort.sendMessage(input.chatId, expenseCopies.saving());

    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'EXPENSE_SAVING',
      payload: { ...input.payload },
    });

    // The third argument is a legacy spreadsheetId placeholder that the current
    // save() implementation does not use; it is kept to preserve the interface.
    let saveResult: { sheetName: string; rowIndex?: number | undefined };
    try {
      saveResult = await this.deps.registerExpense.save(input.userId, input.payload, '');
    } catch (error) {
      await this.handleSaveFailure(input, error);
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
  }

  private async handleSaveFailure(
    input: ResolveExpenseSummaryActionInput,
    error: unknown,
  ): Promise<void> {
    const spreadsheetError =
      error instanceof SpreadsheetError
        ? error
        : new SpreadsheetError('Unexpected expense save failure');

    await this.deps.operationLogRepo.create(
      input.userId,
      'EXPENSE_SAVE_FAILED',
      { failureCode: spreadsheetError.code },
      spreadsheetError.code,
    );

    if (spreadsheetError.retryable) {
      const retryPayload: ExpenseSaveRetryPayload = {
        expense: input.payload,
        failureCode: spreadsheetError.code,
        firstAttemptAt: new Date().toISOString(),
        attemptCount: 1,
      };
      await this.deps.transitionState.execute({
        userId: input.userId,
        targetState: 'EXPENSE_SAVING_RETRY',
        payload: { ...retryPayload },
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      await this.deps.messagingPort.sendMessage(input.chatId, expenseCopies.saveNetworkFailure());
      return;
    }

    await this.deps.transitionState.execute({ userId: input.userId, targetState: 'IDLE' });
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

  private async handleCorrect(input: ResolveExpenseSummaryActionInput): Promise<void> {
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

  private async handleCancel(input: ResolveExpenseSummaryActionInput): Promise<void> {
    await this.deps.cancelExpenseRegistration.execute({
      userId: input.userId,
      chatId: input.chatId,
      currentState: 'EXPENSE_REVIEW',
      source: input.cancellationSource ?? 'callback',
    });
  }
}
