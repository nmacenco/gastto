// LAYER: Application
// Cancels an in-progress expense registration without touching expense records.

import type { FsmState } from '../../../domain/entities/ConversationState';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { expenseCopies } from '../../copies/expense.copies';

const ACTIVE_EXPENSE_STATES: readonly FsmState[] = [
  'EXPENSE_RECEIVING',
  'EXPENSE_CLARIFYING',
  'EXPENSE_REVIEW',
  'EXPENSE_CORRECTING',
];

export interface CancelExpenseRegistrationInput {
  userId: string;
  chatId: string;
  currentState: FsmState;
  source: 'text' | 'callback';
}

export type CancelExpenseRegistrationOutcome =
  | { status: 'not_requested' }
  | { status: 'cancelled' }
  | { status: 'no_active_expense' };

export interface CancelExpenseRegistrationDeps {
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
}

export class CancelExpenseRegistrationUseCase {
  constructor(private readonly deps: CancelExpenseRegistrationDeps) {}

  async execute(input: CancelExpenseRegistrationInput): Promise<CancelExpenseRegistrationOutcome> {
    if (!ACTIVE_EXPENSE_STATES.includes(input.currentState)) {
      await this.deps.messagingPort.sendMessage(
        input.chatId,
        expenseCopies.noActiveExpenseToCancel(),
      );
      return { status: 'no_active_expense' };
    }

    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
    });
    await this.deps.messagingPort.sendMessage(input.chatId, expenseCopies.cancelled());
    return { status: 'cancelled' };
  }
}
