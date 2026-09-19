// LAYER: Application. Revalidates and dispatches bounded semantic control proposals.

import type {
  ConversationState,
  ConversationStatePrecondition,
} from '../../../domain/entities/ConversationState';
import { ExpenseClarificationState } from '../../../domain/value-objects/expense-clarification-state';
import { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import { tryNormalizeExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type {
  ControlSemanticDecision,
  SemanticControlProvenance,
} from '../../services/semantic-router/control-capabilities';
import type { ValidateConversationSnapshot } from '../../services/semantic-router/ValidateConversationSnapshot';
import type { CancelExpenseRegistrationUseCase } from './CancelExpenseRegistrationUseCase';
import type { PresentUndoConfirmation } from './PresentUndoConfirmation';
import type { UndoLastExpenseUseCase } from './UndoLastExpense';

export type ControlGuidanceReason =
  | 'stale_context'
  | 'invalid_state_context'
  | 'unsupported_action'
  | 'ambiguous_intent'
  | 'mixed_intents'
  | 'dispatch_failed';

export interface DispatchControlSemanticActionInput {
  readonly userId: string;
  readonly externalId: string;
  readonly channel: 'telegram' | 'whatsapp';
  readonly conversationState: ConversationState;
  readonly expected: ConversationStatePrecondition;
  readonly decision: ControlSemanticDecision;
  readonly provenance: SemanticControlProvenance;
}

export type DispatchControlSemanticActionOutcome =
  | { readonly status: 'cancelled' }
  | { readonly status: 'undo_confirmation_presented'; readonly pendingExpenseId: string }
  | { readonly status: 'undo_unavailable' }
  | { readonly status: 'explicit_command_required'; readonly command: 'reintentar' }
  | { readonly status: 'reconfiguration_started' }
  | { readonly status: 'clarification_required'; readonly reason: ControlGuidanceReason };

export class DispatchControlSemanticAction {
  constructor(
    private readonly deps: {
      readonly snapshotValidator: Pick<ValidateConversationSnapshot, 'execute'>;
      readonly cancelExpenseRegistration: Pick<CancelExpenseRegistrationUseCase, 'execute'>;
      readonly undoLastExpense: Pick<UndoLastExpenseUseCase, 'execute'>;
      readonly presentUndoConfirmation: Pick<PresentUndoConfirmation, 'execute'>;
    },
  ) {}

  async execute(
    input: DispatchControlSemanticActionInput,
  ): Promise<DispatchControlSemanticActionOutcome> {
    const snapshot = await this.deps.snapshotValidator.execute({
      userId: input.userId,
      expected: input.expected,
    });
    if (snapshot.status !== 'current') {
      return { status: 'clarification_required', reason: 'stale_context' };
    }

    try {
      if (input.decision.action === 'cancel_current_flow') {
        if (!this.hasValidCancellationContext(snapshot.state)) {
          return { status: 'clarification_required', reason: 'invalid_state_context' };
        }
        const result = await this.deps.cancelExpenseRegistration.execute({
          userId: input.userId,
          chatId: input.externalId,
          currentState: snapshot.state.currentState,
          source: 'semantic',
          channel: input.channel,
          expected: input.expected,
        });
        return result.status === 'cancelled'
          ? { status: 'cancelled' }
          : { status: 'clarification_required', reason: 'unsupported_action' };
      }

      if (input.decision.action === 'undo_last_expense') {
        if (snapshot.state.currentState !== 'IDLE') {
          return { status: 'clarification_required', reason: 'unsupported_action' };
        }
        const undo = await this.deps.undoLastExpense.execute({
          userId: input.userId,
          action: 'request',
          provenance: 'semantic_request',
        });
        if (undo.status === 'not_found') return { status: 'undo_unavailable' };
        if (undo.status !== 'confirmation_required' || !undo.expense) {
          return { status: 'clarification_required', reason: 'dispatch_failed' };
        }
        const presentation = await this.deps.presentUndoConfirmation.execute({
          userId: input.userId,
          chatId: input.externalId,
          expense: undo.expense,
          expected: input.expected,
        });
        return presentation.status === 'presented'
          ? {
              status: 'undo_confirmation_presented',
              pendingExpenseId: presentation.pendingExpenseId,
            }
          : {
              status: 'clarification_required',
              reason: presentation.status === 'stale' ? 'stale_context' : 'dispatch_failed',
            };
      }

      return { status: 'clarification_required', reason: 'unsupported_action' };
    } catch {
      return { status: 'clarification_required', reason: 'dispatch_failed' };
    }
  }

  private hasValidCancellationContext(state: ConversationState): boolean {
    switch (state.currentState) {
      case 'EXPENSE_RECEIVING':
        return (
          typeof state.statePayload?.raw_message === 'string' &&
          state.statePayload.raw_message.trim().length > 0
        );
      case 'EXPENSE_CLARIFYING':
        try {
          ExpenseClarificationState.fromPayload(state.statePayload);
          return true;
        } catch {
          return false;
        }
      case 'EXPENSE_REVIEW': {
        const review = tryNormalizeExpenseReviewPayload(state.statePayload);
        return review?.reviewBinding?.presentedAt !== null && review?.reviewBinding !== undefined;
      }
      case 'EXPENSE_CORRECTING':
        try {
          ExpenseCorrectionState.fromPayload(state.statePayload);
          return true;
        } catch {
          return false;
        }
      default:
        return false;
    }
  }
}
