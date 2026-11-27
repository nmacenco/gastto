// LAYER: Application
// Delivery evidence is recorded only for the exact draft revision that was sent.
import { randomUUID } from 'node:crypto';
import type { MessagingOutputPort } from '../ports/output/messaging.port';
import type { TransitionConversationState } from '../use-cases/conversation/TransitionConversationState';
import { categoryProposalFingerprint } from '../dtos/CategoryOnboardingState';
import { StaleConversationStateError } from '../../domain/errors/StaleConversationStateError';

export async function presentCategoryProposal(
  deps: { transitionState: TransitionConversationState; messagingPort: MessagingOutputPort },
  input: { userId: string; externalId: string; payload: Record<string, unknown>; message: string },
): Promise<void> {
  const {
    paymentReview: _review,
    paymentMethods: _payments,
    paymentColumnMapped: _mapped,
    ...categoryPayload
  } = input.payload;
  const payload = {
    ...categoryPayload,
    categoryProposalId: randomUUID(),
    categoryPresentation: null,
    categoryAcceptance: null,
  };
  const deadline = deps.transitionState.currentState(input.userId)?.expiresAt ?? null;
  const saved = await deps.transitionState.execute({
    userId: input.userId,
    targetState: 'ONBOARDING_CATEGORIES',
    payload,
    expiresAt: deadline,
  });
  if (saved.status !== 'updated') throw new StaleConversationStateError(saved);
  const delivered = await deps.messagingPort.sendMessage(input.externalId, input.message);
  if (delivered.status !== 'success') return;
  await deps.transitionState.execute({
    userId: input.userId,
    targetState: 'ONBOARDING_CATEGORIES',
    expected: deps.transitionState.precondition(
      saved.state,
      deadline === null ? 'any' : 'unexpired',
    ),
    expiresAt: deadline,
    payload: {
      ...payload,
      categoryPresentation: {
        proposalId: payload.categoryProposalId,
        fingerprint: categoryProposalFingerprint(payload),
        presentedAt: new Date().toISOString(),
      },
    },
  });
}
