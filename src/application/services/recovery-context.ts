// LAYER: Application
import {
  getFinancialExecutionClaim,
  type ConversationState,
} from '../../domain/entities/ConversationState';

export type RecoveryContext = 'cancellable' | 'idle' | 'financially-blocked' | 'unknown';

/** Mirrors guarded conversation exits; never infer eligibility from an incoming snapshot. */
export function resolveRecoveryContext(
  state: ConversationState | null | undefined,
): RecoveryContext {
  if (state === undefined) return 'unknown';
  if (getFinancialExecutionClaim(state?.statePayload ?? null) !== null)
    return 'financially-blocked';
  if (!state || state.currentState === 'IDLE') return 'idle';
  if (state.expiresAt && state.expiresAt.getTime() <= Date.now()) return 'unknown';
  if (
    state.currentState.startsWith('ONBOARDING_') ||
    state.currentState.startsWith('SETTINGS_') ||
    [
      'EXPENSE_RECEIVING',
      'EXPENSE_CLARIFYING',
      'EXPENSE_REVIEW',
      'EXPENSE_CORRECTING',
      'EXPENSE_SAVING',
      'EXPENSE_SAVING_RETRY',
      'EXPENSE_UNDO_CONFIRMING',
    ].includes(state.currentState)
  )
    return 'cancellable';
  return 'unknown';
}

export async function readRecoveryState(
  read: () => Promise<ConversationState | null>,
): Promise<ConversationState | null | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}
