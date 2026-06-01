// LAYER: Application
// Use case: validate and execute FSM state transitions.
// Encapsulates transition rules so the Interfaces layer never calls the repository directly.

import {
  canTransition,
  type FsmState,
  type ConversationState,
} from '../../../domain/entities/ConversationState';
import { InvalidStateTransitionError } from '../../../domain/errors/InvalidStateTransitionError';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';

export interface TransitionConversationStateInput {
  userId: string;
  targetState: FsmState;
  payload?: Record<string, unknown> | null;
  expiresAt?: Date | null;
}

export class TransitionConversationState {
  constructor(private readonly conversationRepo: IConversationStateRepository) {}

  async execute(input: TransitionConversationStateInput): Promise<ConversationState> {
    const current = await this.conversationRepo.findByUserId(input.userId);
    const fromState = current?.currentState ?? 'IDLE';

    if (!canTransition(fromState, input.targetState)) {
      throw new InvalidStateTransitionError(fromState, input.targetState);
    }

    return this.conversationRepo.transition(
      input.userId,
      input.targetState,
      input.payload ?? null,
      input.expiresAt ?? null,
    );
  }
}
