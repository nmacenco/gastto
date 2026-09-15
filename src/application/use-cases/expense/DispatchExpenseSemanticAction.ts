// LAYER: Application. Executes only explicitly enabled semantic expense actions.
import type {
  ConversationState,
  ConversationStatePrecondition,
} from '../../../domain/entities/ConversationState';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type { ExpenseSemanticDecision } from '../../services/semantic-router/expense-capabilities';
import type { ValidateConversationSnapshot } from '../../services/semantic-router/ValidateConversationSnapshot';
import type { RegisterExpenseUseCase } from './RegisterExpense';

export type ExpenseGuidanceReason =
  | 'stale_context'
  | 'unsupported_action'
  | 'registration_unavailable'
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
      readonly registerExpense: Pick<RegisterExpenseUseCase, 'interpret'> | null;
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
    if (
      input.decision.action !== 'register_expense' ||
      (snapshot.state.currentState !== 'IDLE' &&
        snapshot.state.currentState !== 'EXPENSE_RECEIVING')
    ) {
      return { status: 'clarification_required', reason: 'unsupported_action' };
    }
    if (!this.deps.registerExpense) {
      return { status: 'clarification_required', reason: 'registration_unavailable' };
    }

    try {
      const result = await this.deps.registerExpense.interpret({
        userId: input.userId,
        rawMessage: input.rawMessage,
        channel: input.channel,
      });
      if (result.status === 'needs_clarification') {
        return { status: 'missing_data', field: result.missingField };
      }
      return { status: 'review_required', payload: result.payload };
    } catch {
      return { status: 'clarification_required', reason: 'dispatch_failed' };
    }
  }
}
