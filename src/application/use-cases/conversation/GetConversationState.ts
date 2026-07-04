// LAYER: Application
// Use case: retrieve the current conversation state for a user.
// Encapsulates repository access so the Interfaces layer never calls it directly.

import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';

export interface GetConversationStateInput {
  userId: string;
}

export class GetConversationState {
  constructor(private readonly conversationRepo: IConversationStateRepository) {}

  async execute(input: GetConversationStateInput): Promise<ConversationState | null> {
    return this.conversationRepo.findByUserId(input.userId);
  }
}
