import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { TransitionConversationState } from './TransitionConversationState';

export async function markAccessWelcomeShown(
  state: ConversationState | null,
  transitionState: TransitionConversationState,
): Promise<void> {
  if (
    !state ||
    state.statePayload?.accessWelcomeShown === true ||
    (state.currentState !== 'ONBOARDING_START' && state.currentState !== 'IDLE')
  )
    return;
  await transitionState.execute({
    userId: state.userId,
    targetState: state.currentState,
    payload: { ...(state.statePayload ?? {}), accessWelcomeShown: true },
    expected: transitionState.precondition(state, 'any'),
  });
}
