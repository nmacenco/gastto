// LAYER: Application
// Cancels an in-progress expense registration without touching expense records.

import type {
  ConversationStatePrecondition,
  FsmState,
} from '../../../domain/entities/ConversationState';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { expenseCopies } from '../../copies/expense.copies';
import type { AdvancePendingExpense } from './AdvancePendingExpense';

const ACTIVE_EXPENSE_STATES: readonly FsmState[] = [
  'EXPENSE_RECEIVING',
  'EXPENSE_CLARIFYING',
  'EXPENSE_REVIEW',
  'EXPENSE_CORRECTING',
];

interface CancelExpenseRegistrationInputBase {
  userId: string;
  chatId: string;
  currentState: FsmState;
  channel?: 'telegram' | 'whatsapp';
  completedCount?: number;
}

export type CancelExpenseRegistrationInput = CancelExpenseRegistrationInputBase &
  (
    | { source: 'text' | 'callback' }
    | { source: 'semantic'; expected: ConversationStatePrecondition }
  );

export type CancelExpenseRegistrationOutcome =
  | { status: 'not_requested' }
  | { status: 'cancelled' }
  | { status: 'no_active_expense' };

export interface CancelExpenseRegistrationDeps {
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  advancePendingExpense?: AdvancePendingExpense;
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
      ...(input.source === 'semantic' ? { expected: input.expected } : {}),
    });
    await this.deps.messagingPort.sendMessage(input.chatId, expenseCopies.cancelled());
    if (this.deps.advancePendingExpense) {
      await this.deps.advancePendingExpense.execute({
        userId: input.userId,
        chatId: input.chatId,
        channel: input.channel ?? 'telegram',
        reason: 'cancelled',
        completedCount: input.completedCount ?? 0,
      });
    }
    return { status: 'cancelled' };
  }
}
