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

    // The third argument is a legacy spreadsheetId placeholder that the current
    // save() implementation does not use; it is kept to preserve the interface.
    const saveResult = await this.deps.registerExpense.save(input.userId, input.payload, '');

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
