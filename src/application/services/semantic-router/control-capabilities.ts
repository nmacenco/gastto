// LAYER: Application. Control proposals are capabilities, never effect authorization.
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { ConversationDecision } from '../../../domain/value-objects/conversation-decision';

export type ControlSemanticDecision = Extract<
  ConversationDecision,
  | { action: 'cancel_current_flow' }
  | { action: 'undo_last_expense' }
  | { action: 'request_save_retry' }
  | { action: 'request_reconfiguration' }
>;

export interface SemanticControlProvenance {
  readonly kind: 'semantic_proposal';
  readonly sourceMessageId: string;
}

type ControlSemanticAction = ControlSemanticDecision['action'];

// Only the default user-input substep is eligible. Unknown substeps fail closed.
// EXPENSE_UNDO_CONFIRMING is intentionally guidance-only and grants no control capability.
export const CONTROL_SEMANTIC_CAPABILITY_MATRIX: Readonly<
  Record<FsmState, Readonly<Record<string, readonly ControlSemanticAction[]>>>
> = {
  IDLE: { default: ['undo_last_expense'] },
  EXPENSE_RECEIVING: { default: ['cancel_current_flow'] },
  EXPENSE_CLARIFYING: { default: ['cancel_current_flow'] },
  EXPENSE_REVIEW: { default: ['cancel_current_flow'] },
  EXPENSE_CORRECTING: { default: ['cancel_current_flow'] },
  EXPENSE_SAVING: {},
  EXPENSE_SAVING_RETRY: {
    default: ['request_save_retry', 'request_reconfiguration'],
  },
  EXPENSE_UNDO_CONFIRMING: { default: [] },
  ONBOARDING_START: {},
  ONBOARDING_DRIVE: {},
  ONBOARDING_FILE: {},
  ONBOARDING_SHEET: {},
  ONBOARDING_VALIDATING_ACCESS: {},
  ONBOARDING_MAPPING: {},
  ONBOARDING_CATEGORIES: {},
};

export function isControlSemanticDecision(
  decision: ConversationDecision,
): decision is ControlSemanticDecision {
  return [
    'cancel_current_flow',
    'undo_last_expense',
    'request_save_retry',
    'request_reconfiguration',
  ].includes(decision.action);
}

export function isControlCapabilityAllowed(
  state: FsmState,
  substep: string | null,
  decision: ControlSemanticDecision,
): boolean {
  const actions = CONTROL_SEMANTIC_CAPABILITY_MATRIX[state][substep ?? 'default'];
  return actions?.includes(decision.action) ?? false;
}
