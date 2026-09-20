// LAYER: Application. Persists and presents one bound delayed-undo offer.

import type { ConversationStatePrecondition } from '../../../domain/entities/ConversationState';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';
import { advanceExpenseReviewBinding } from '../../../domain/value-objects/expense-review-binding';
import { expenseCopies } from '../../copies/expense.copies';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';

const UNDO_CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

export interface PresentUndoConfirmationInput {
  readonly userId: string;
  readonly chatId: string;
  readonly expense: {
    readonly id: string;
    readonly concepto: string;
    readonly monto: number;
    readonly moneda: string;
    readonly savedAt: Date;
  };
  readonly expected: ConversationStatePrecondition;
  readonly previousBinding?: Parameters<typeof advanceExpenseReviewBinding>[0];
}

export type PresentUndoConfirmationOutcome =
  | { readonly status: 'presented'; readonly pendingExpenseId: string }
  | { readonly status: 'unbound'; readonly pendingExpenseId: string }
  | { readonly status: 'stale' };

export class PresentUndoConfirmation {
  constructor(
    private readonly deps: {
      readonly transitionState: Pick<TransitionConversationState, 'execute'>;
      readonly messagingPort: MessagingOutputPort;
    },
  ) {}

  async execute(input: PresentUndoConfirmationInput): Promise<PresentUndoConfirmationOutcome> {
    const actionBinding = advanceExpenseReviewBinding(input.previousBinding);
    const expiresAt = new Date(Date.now() + UNDO_CONFIRMATION_TIMEOUT_MS);
    const payload = { pendingExpenseId: input.expense.id, actionBinding };
    let boundState;
    try {
      const transition = await this.deps.transitionState.execute({
        userId: input.userId,
        targetState: 'EXPENSE_UNDO_CONFIRMING',
        payload,
        expiresAt,
        expected: input.expected,
      });
      if (transition.status !== 'updated') return { status: 'stale' };
      boundState = transition.state;
    } catch (error) {
      if (error instanceof StaleConversationStateError) return { status: 'stale' };
      throw error;
    }

    let delivery;
    try {
      delivery = await this.deps.messagingPort.sendMessage(
        input.chatId,
        expenseCopies.undoConfirmationRequired(
          input.expense.concepto,
          input.expense.monto,
          input.expense.moneda,
          input.expense.savedAt,
        ),
      );
    } catch {
      return { status: 'unbound', pendingExpenseId: input.expense.id };
    }
    if (delivery.status !== 'success') {
      return { status: 'unbound', pendingExpenseId: input.expense.id };
    }

    try {
      await this.deps.transitionState.execute({
        userId: input.userId,
        targetState: 'EXPENSE_UNDO_CONFIRMING',
        payload: {
          ...payload,
          actionBinding: { ...actionBinding, presentedAt: new Date().toISOString() },
        },
        expiresAt,
        expected: {
          revision: boundState.revision,
          currentState: boundState.currentState,
          expiry: 'unexpired',
        },
      });
      return { status: 'presented', pendingExpenseId: input.expense.id };
    } catch (error) {
      if (error instanceof StaleConversationStateError) return { status: 'stale' };
      throw error;
    }
  }
}
