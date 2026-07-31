// LAYER: Application
// Use case: resolves the action chosen by the user on the interpreted expense
// summary (confirm, correct, cancel). Keeps business logic out of the worker
// and route layers.

import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { RegisterExpenseUseCase, ExpenseReviewPayload } from './RegisterExpense';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { expenseCopies } from '../../copies/expense.copies';

export interface ResolveExpenseSummaryActionInput {
  userId: string;
  action: 'confirm' | 'correct' | 'cancel';
  payload: ExpenseReviewPayload;
  chatId: string;
}

export interface ResolveExpenseSummaryActionDeps {
  registerExpense: RegisterExpenseUseCase;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
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
    await this.deps.registerExpense.save(input.userId, input.payload, '');

    await this.deps.messagingPort.sendMessage(
      input.chatId,
      expenseCopies.expenseSavedConfirmation(),
    );
  }

  private async handleCorrect(input: ResolveExpenseSummaryActionInput): Promise<void> {
    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'EXPENSE_CORRECTING',
      payload: input.payload as unknown as Record<string, unknown>,
    });

    await this.deps.messagingPort.sendMessage(
      input.chatId,
      expenseCopies.expenseCorrectionPrompt(),
    );
  }

  private async handleCancel(input: ResolveExpenseSummaryActionInput): Promise<void> {
    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'IDLE',
      payload: null,
    });

    await this.deps.messagingPort.sendMessage(input.chatId, expenseCopies.cancelled());
  }
}
