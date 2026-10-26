import type { ConversationStatePrecondition } from '../../../domain/entities/ConversationState';
import {
  PaymentMethodCatalog,
  normalizePaymentMethodName,
} from '../../../domain/entities/PaymentMethodCatalog';
import type { IPaymentMethodCatalogRepository } from '../../../domain/ports/PaymentMethodCatalogRepository';
import { advanceExpenseReviewBinding } from '../../../domain/value-objects/expense-review-binding';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type { PaymentMethodSelection } from '../../../domain/value-objects/payment-method-selection';
import type {
  ExpensePaymentResolutionCommit,
  PaymentResolutionAction,
} from '../../ports/ExpensePaymentResolutionCommit';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type {
  ExpenseReviewAuthorizationEvidence,
  ResolveExpenseSummaryActionUseCase,
} from './ResolveExpenseSummaryActionUseCase';

export type ResolveExpensePaymentAction =
  | { kind: 'select'; name: string }
  | { kind: 'add' }
  | { kind: 'clear' };
export type ResolveExpensePaymentOutcome =
  | { status: 'updated'; payload: ExpenseReviewPayload; added: boolean }
  | { status: 'stale' | 'invalid' | 'unbound' | 'expired' | 'operation_in_progress' };

export class ResolveExpensePaymentMethod {
  constructor(
    private readonly deps: {
      authorization: ResolveExpenseSummaryActionUseCase;
      transitionState: TransitionConversationState;
      catalogRepository: IPaymentMethodCatalogRepository;
      commit: ExpensePaymentResolutionCommit;
    },
  ) {}

  async execute(input: {
    userId: string;
    expected: ConversationStatePrecondition;
    authorization: ExpenseReviewAuthorizationEvidence;
    action: ResolveExpensePaymentAction;
  }): Promise<ResolveExpensePaymentOutcome> {
    const authorized = this.deps.authorization.authorizeReview({
      userId: input.userId,
      action: 'correct',
      chatId: '',
      authorization: input.authorization,
    });
    if (authorized.status !== 'authorized')
      return { status: authorized.status === 'payment_unresolved' ? 'invalid' : authorized.status };
    const observed = this.deps.transitionState.currentState(input.userId);
    if (
      !observed ||
      observed.revision !== input.expected.revision ||
      observed.currentState !== input.expected.currentState
    )
      return { status: 'stale' };
    const current = authorized.payload;
    const sourceConfigId = current.paymentMethodSelection?.sourceConfigId;
    if (!sourceConfigId) return { status: 'invalid' };
    const catalog = await this.deps.catalogRepository.findBySpreadsheetId(sourceConfigId);
    if (!catalog) return { status: 'invalid' };
    let selection: PaymentMethodSelection;
    let action: PaymentResolutionAction;
    let added = false;
    if (input.action.kind === 'select') {
      const selectedName = normalizePaymentMethodName(input.action.name);
      const method = catalog.getActive().find((entry) => entry.normalizedName === selectedName);
      if (!method) return { status: 'invalid' };
      selection = {
        status: 'matched',
        sourceConfigId,
        paymentMethodId: method.id,
        canonicalName: method.name,
        unresolvedRaw: null,
      };
      action = { kind: 'select', paymentMethodId: method.id };
    } else if (input.action.kind === 'add') {
      const unknown = current.paymentMethodSelection;
      if (!unknown || unknown.status !== 'unresolved') return { status: 'invalid' };
      const proposal = new PaymentMethodCatalog(sourceConfigId, [...catalog.getMethods()]);
      const method = proposal.add(unknown.unresolvedRaw);
      selection = {
        status: 'matched',
        sourceConfigId,
        paymentMethodId: method.id,
        canonicalName: method.name,
        unresolvedRaw: null,
      };
      action = { kind: 'add', paymentMethodId: method.id, name: method.name };
      added = true;
    } else {
      selection = {
        status: 'none',
        sourceConfigId,
        paymentMethodId: null,
        canonicalName: null,
        unresolvedRaw: null,
      };
      action = { kind: 'clear' };
    }
    const next: ExpenseReviewPayload = {
      ...current,
      extracted:
        input.action.kind === 'clear'
          ? { ...current.extracted, medioPago: null }
          : current.extracted,
      paymentMethodSelection: selection,
      reviewBinding: advanceExpenseReviewBinding(current.reviewBinding),
    };
    const result = await this.deps.commit.execute({
      userId: input.userId,
      expected: input.expected,
      sourceConfigId,
      current,
      next,
      action,
    });
    if (result.status !== 'updated') return { status: result.status };
    this.deps.transitionState.adoptCommittedState(result.state);
    return { status: 'updated', payload: next, added };
  }
}
