// LAYER: Application. Enabled semantic option capabilities narrow proposal policy.
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { ConversationDecision } from '../../../domain/value-objects/conversation-decision';
import { isIdkVariant } from '../../utils/intents';
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
  return (
    (state.currentState === 'ONBOARDING_FILE' || state.currentState === 'ONBOARDING_SHEET') &&
    projectOptionSelectionSnapshot(state) !== null
  );
}

export function shouldBypassSemanticOptionSelection(
  conversationState: ConversationState,
  rawMessage: string,
): boolean {
  if (
    conversationState.currentState !== 'ONBOARDING_FILE' &&
    conversationState.currentState !== 'ONBOARDING_SHEET'
  )
    return false;
  const payload = conversationState.statePayload;
  if (
    payload?.provider === 'microsoft' ||
    payload?.step === 'searching' ||
    payload?.step === 'empty-sheet-confirm'
  )
    return true;
  if (projectOptionSelectionSnapshot(conversationState) === null) return true;

  const normalized = rawMessage.toLocaleLowerCase('es').trim().replace(/\s+/g, ' ');
  if (/^\d+$/.test(normalized)) return true;
  if (conversationState.currentState === 'ONBOARDING_SHEET' && isIdkVariant(rawMessage))
    return true;
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
