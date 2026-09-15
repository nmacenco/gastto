// LAYER: Application. Semantic expense capabilities narrow, never broaden, semantic-policy-v1.
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { ConversationDecision } from '../../../domain/value-objects/conversation-decision';

export type ExpenseSemanticDecision = Extract<
  ConversationDecision,
  | { action: 'register_expense' }
  | { action: 'provide_missing_expense_data' }
  | { action: 'correct_expense' }
  | { action: 'request_clarification' }
  | { action: 'out_of_scope' }
>;

type ExpenseSemanticAction = ExpenseSemanticDecision['action'];

export const EXPENSE_SEMANTIC_CAPABILITY_MATRIX: Readonly<
  Record<FsmState, readonly ExpenseSemanticAction[]>
> = {
  IDLE: ['register_expense', 'request_clarification', 'out_of_scope'],
  EXPENSE_RECEIVING: ['register_expense', 'request_clarification', 'out_of_scope'],
  EXPENSE_CLARIFYING: [
    'provide_missing_expense_data',
    'register_expense',
    'request_clarification',
    'out_of_scope',
  ],
  EXPENSE_REVIEW: ['correct_expense', 'register_expense', 'request_clarification', 'out_of_scope'],
  EXPENSE_CORRECTING: [],
  EXPENSE_SAVING: [],
  EXPENSE_SAVING_RETRY: [],
  EXPENSE_UNDO_CONFIRMING: [],
  ONBOARDING_START: [],
  ONBOARDING_DRIVE: [],
  ONBOARDING_FILE: [],
  ONBOARDING_SHEET: [],
  ONBOARDING_VALIDATING_ACCESS: [],
  ONBOARDING_MAPPING: [],
  ONBOARDING_CATEGORIES: [],
};

export function isExpenseSemanticDecision(
  decision: ConversationDecision,
): decision is ExpenseSemanticDecision {
  return (
    EXPENSE_SEMANTIC_CAPABILITY_MATRIX.IDLE.includes(decision.action as ExpenseSemanticAction) ||
    ['provide_missing_expense_data', 'correct_expense'].includes(decision.action)
  );
}

export function isExpenseCapabilityAllowed(
  state: FsmState,
  decision: ExpenseSemanticDecision,
): boolean {
  return EXPENSE_SEMANTIC_CAPABILITY_MATRIX[state].includes(decision.action);
}

export function isEnabledExpenseRecognitionState(state: FsmState): boolean {
  return state === 'IDLE' || state === 'EXPENSE_RECEIVING';
}
