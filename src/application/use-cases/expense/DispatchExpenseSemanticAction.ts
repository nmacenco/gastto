// LAYER: Application. Executes only explicitly enabled semantic expense actions.
import type {
  ConversationState,
  ConversationStatePrecondition,
} from '../../../domain/entities/ConversationState';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type { ExpenseSemanticDecision } from '../../services/semantic-router/expense-capabilities';
import type { ValidateConversationSnapshot } from '../../services/semantic-router/ValidateConversationSnapshot';
import { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import { tryNormalizeExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { ExpenseClarificationState } from '../../../domain/value-objects/expense-clarification-state';
import type { CompleteExpenseClarification } from './CompleteExpenseClarification';
import type { CorrectExpenseUseCase } from './CorrectExpenseUseCase';
import type { QueuePendingExpense } from './QueuePendingExpense';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { RegisterExpenseUseCase } from './RegisterExpense';

export type ExpenseGuidanceReason =
  | 'stale_context'
  | 'unsupported_action'
  | 'registration_unavailable'
  | 'invalid_state_context'
  | 'correction_not_interpretable'
  | 'invalid_subcategory'
  | 'correction_cycle_limit'
  | 'dispatch_failed';

export interface DispatchExpenseSemanticActionInput {
  readonly userId: string;
  readonly externalId: string;
  readonly externalMessageId: string;
  readonly receivedAt: string;
  readonly channel: 'telegram' | 'whatsapp';
  readonly rawMessage: string;
  readonly conversationState: ConversationState;
  readonly expected: ConversationStatePrecondition;
  readonly decision: ExpenseSemanticDecision;
}

export type DispatchExpenseSemanticActionOutcome =
  | { readonly status: 'review_required'; readonly payload: ExpenseReviewPayload }
  | { readonly status: 'missing_data'; readonly field: 'monto' | 'moneda' }
  | { readonly status: 'expense_queued'; readonly pendingCount: 1 | 2 }
  | { readonly status: 'queue_full'; readonly pendingCount: 2 }
  | { readonly status: 'clarification_required'; readonly reason: ExpenseGuidanceReason };

export class DispatchExpenseSemanticAction {
  constructor(
    private readonly deps: {
      readonly snapshotValidator: Pick<ValidateConversationSnapshot, 'execute'>;
      readonly transitionState: Pick<TransitionConversationState, 'execute' | 'currentState'>;
      readonly registerExpense: Pick<RegisterExpenseUseCase, 'interpret'> | null;
      readonly completeClarification: Pick<CompleteExpenseClarification, 'execute'>;
      readonly correctExpense: Pick<CorrectExpenseUseCase, 'execute'>;
      readonly queuePendingExpense: Pick<QueuePendingExpense, 'execute'>;
    },
  ) {}

  async execute(
    input: DispatchExpenseSemanticActionInput,
  ): Promise<DispatchExpenseSemanticActionOutcome> {
    const snapshot = await this.deps.snapshotValidator.execute({
      userId: input.userId,
      expected: input.expected,
    });
    if (snapshot.status !== 'current') {
      return { status: 'clarification_required', reason: 'stale_context' };
    }
    let enteredReceiving = false;
    try {
      const state = snapshot.state.currentState;
      if (input.decision.action === 'register_expense') {
        if (state === 'EXPENSE_REVIEW') {
          const queued = await this.deps.queuePendingExpense.execute({
            userId: input.userId,
            rawMessage: input.rawMessage,
            channel: input.channel,
          });
          return queued.status === 'queued'
            ? { status: 'expense_queued', pendingCount: queued.pendingCount }
            : { status: 'queue_full', pendingCount: queued.pendingCount };
        }

        if (!this.deps.registerExpense) {
          return { status: 'clarification_required', reason: 'registration_unavailable' };
        }

        let queueRegisteredCount: number | undefined;
        if (state === 'EXPENSE_CLARIFYING') {
          const clarification = ExpenseClarificationState.fromPayload(snapshot.state.statePayload);
          queueRegisteredCount = clarification.queueRegisteredCount;
        } else if (state !== 'IDLE' && state !== 'EXPENSE_RECEIVING') {
          return { status: 'clarification_required', reason: 'unsupported_action' };
        }
        if (state === 'IDLE') {
          await this.deps.transitionState.execute({
            userId: input.userId,
            targetState: 'EXPENSE_RECEIVING',
            payload: { raw_message: input.rawMessage },
          });
          enteredReceiving = true;
        }

        return this.mapInterpretation(
          await this.deps.registerExpense.interpret({
            userId: input.userId,
            rawMessage: input.rawMessage,
            channel: input.channel,
            ...(queueRegisteredCount === undefined ? {} : { queueRegisteredCount }),
          }),
        );
      }

      if (input.decision.action === 'provide_missing_expense_data') {
        if (state !== 'EXPENSE_CLARIFYING') {
          return { status: 'clarification_required', reason: 'unsupported_action' };
        }
        return this.mapInterpretation(
          await this.deps.completeClarification.execute({
            userId: input.userId,
            rawReply: input.rawMessage,
            channel: input.channel,
            statePayload: snapshot.state.statePayload,
          }),
        );
      }

      if (input.decision.action === 'correct_expense') {
        if (state !== 'EXPENSE_REVIEW') {
          return { status: 'clarification_required', reason: 'unsupported_action' };
        }
        const payload = tryNormalizeExpenseReviewPayload(snapshot.state.statePayload);
        if (payload === null) {
          return { status: 'clarification_required', reason: 'invalid_state_context' };
        }
        const correction = await this.deps.correctExpense.execute({
          userId: input.userId,
          rawMessage: input.rawMessage,
          channel: input.channel,
          state: ExpenseCorrectionState.create(
            payload,
            0,
            payload.pendingHighAmountConfirmation === true,
          ),
          intentMode: 'validated_correction',
        });
        if (correction.status === 'corrected' || correction.status === 'high_amount_confirmation') {
          return { status: 'review_required', payload: correction.payload };
        }
        if (correction.status === 'invalid_subcategory') {
          return { status: 'clarification_required', reason: 'invalid_subcategory' };
        }
        if (correction.status === 'cycle_limit') {
          return { status: 'clarification_required', reason: 'correction_cycle_limit' };
        }
        return { status: 'clarification_required', reason: 'correction_not_interpretable' };
      }

      return { status: 'clarification_required', reason: 'unsupported_action' };
    } catch {
      const current = this.deps.transitionState.currentState(input.userId);
      if (enteredReceiving && current?.currentState === 'EXPENSE_RECEIVING') {
        try {
          await this.deps.transitionState.execute({
            userId: input.userId,
            targetState: 'IDLE',
            payload: null,
            expiresAt: null,
          });
        } catch {
          // The original dispatch remains failed; a concurrent/stale writer owns recovery.
        }
      }
      return { status: 'clarification_required', reason: 'dispatch_failed' };
    }
  }

  private mapInterpretation(
    result: Awaited<ReturnType<RegisterExpenseUseCase['interpret']>>,
  ): DispatchExpenseSemanticActionOutcome {
    return result.status === 'needs_clarification'
      ? { status: 'missing_data', field: result.missingField }
      : { status: 'review_required', payload: result.payload };
  }
}
