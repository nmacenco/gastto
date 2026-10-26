import type {
  ConversationState,
  ConversationStatePrecondition,
} from '../../domain/entities/ConversationState';
import type { ExpenseReviewPayload } from '../../domain/value-objects/expense-review-payload';

export type PaymentResolutionAction =
  | { kind: 'select'; paymentMethodId: string }
  | { kind: 'add'; paymentMethodId: string; name: string }
  | { kind: 'clear' };

export interface ExpensePaymentResolutionCommit {
  execute(input: {
    userId: string;
    expected: ConversationStatePrecondition;
    sourceConfigId: string;
    current: ExpenseReviewPayload;
    next: ExpenseReviewPayload;
    action: PaymentResolutionAction;
  }): Promise<{ status: 'updated'; state: ConversationState } | { status: 'stale' | 'invalid' }>;
}
