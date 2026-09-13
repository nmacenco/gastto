import type { ConversationStateWriteResult } from '../entities/ConversationState';

export class StaleConversationStateError extends Error {
  constructor(
    public readonly result: Exclude<ConversationStateWriteResult, { status: 'updated' }>,
  ) {
    super(`Conversation state write rejected: ${result.status}`);
    this.name = 'StaleConversationStateError';
  }
}
