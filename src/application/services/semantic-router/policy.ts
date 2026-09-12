// LAYER: Application. Proposal policy only; never authorizes effects.
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { ConversationDecision } from '../../../domain/value-objects/conversation-decision';

type Action = ConversationDecision['action'];
export const POLICY_VERSION = 'semantic-policy-v1';
const guidance: readonly Action[] = ['request_clarification', 'out_of_scope'];
const expense: readonly Action[] = ['register_expense', 'cancel_current_flow', ...guidance];
const selection: readonly Action[] = ['select_option', ...guidance];

// null/default is the normal user-input step. Unknown substeps are denied, not widened.
export const STATE_ACTION_POLICY: Readonly<
  Record<FsmState, Readonly<Record<string, readonly Action[]>>>
> = {
  IDLE: { default: ['register_expense', 'undo_last_expense', ...guidance] },
  EXPENSE_RECEIVING: { default: expense },
  EXPENSE_CLARIFYING: { default: ['provide_missing_expense_data', ...expense] },
  EXPENSE_REVIEW: { default: ['correct_expense', ...expense] },
  EXPENSE_CORRECTING: {},
  EXPENSE_SAVING: {},
  EXPENSE_SAVING_RETRY: { default: ['request_save_retry', 'request_reconfiguration', ...guidance] },
  EXPENSE_UNDO_CONFIRMING: { default: guidance },
  ONBOARDING_START: {},
  ONBOARDING_DRIVE: {},
  ONBOARDING_FILE: { default: selection },
  ONBOARDING_SHEET: { default: selection, idk: selection, 'empty-sheet-confirm': guidance },
  ONBOARDING_VALIDATING_ACCESS: {},
  ONBOARDING_MAPPING: {},
  ONBOARDING_CATEGORIES: {},
};

export function allowedActionsFor(
  state: FsmState,
  substep: string | null,
): readonly Action[] | undefined {
  const steps = STATE_ACTION_POLICY[state];
  const step = substep ?? 'default';
  return Object.hasOwn(steps, step) ? steps[step] : undefined;
}
