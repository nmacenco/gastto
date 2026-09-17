// LAYER: Application. Enabled semantic option capabilities narrow proposal policy.
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { ConversationDecision } from '../../../domain/value-objects/conversation-decision';
import { projectOptionSelectionSnapshot } from './ResolveOptionReference';

export type OptionSelectionSemanticDecision = Extract<
  ConversationDecision,
  { readonly action: 'select_option' }
>;

export function isOptionSelectionSemanticDecision(
  decision: ConversationDecision,
): decision is OptionSelectionSemanticDecision {
  return decision.action === 'select_option';
}

export function isEnabledOptionSelectionState(state: ConversationState): boolean {
  return state.currentState === 'ONBOARDING_FILE' && projectOptionSelectionSnapshot(state) !== null;
}

export function shouldBypassSemanticFileSelection(
  conversationState: ConversationState,
  rawMessage: string,
): boolean {
  if (conversationState.currentState !== 'ONBOARDING_FILE') return false;
  const payload = conversationState.statePayload;
  if (payload?.provider === 'microsoft' || payload?.step === 'searching') return true;
  if (projectOptionSelectionSnapshot(conversationState) === null) return true;

  const normalized = rawMessage.toLocaleLowerCase('es').trim().replace(/\s+/g, ' ');
  if (/^\d+$/.test(normalized)) return true;
  if (
    [
      'ninguno',
      'ninguno de estos',
      'ninguna',
      'ninguna de estas',
      'no',
      'no es ninguno',
      'no es ninguna',
      'nope',
    ].includes(normalized)
  )
    return true;

  try {
    const url = new URL(rawMessage.trim());
    return url.hostname === 'drive.google.com';
  } catch {
    return false;
  }
}
