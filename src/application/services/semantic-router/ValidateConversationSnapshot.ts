// LAYER: Application. Read-only post-model optimistic-context validation.
import {
  getFinancialExecutionClaim,
  type ConversationState,
  type ConversationStatePrecondition,
} from '../../../domain/entities/ConversationState';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';

export type ConversationSnapshotCheck =
  | { readonly status: 'current'; readonly state: ConversationState }
  | { readonly status: 'stale' | 'expired' | 'missing' | 'operation_in_progress' };

export class ValidateConversationSnapshot {
  constructor(private readonly repository: IConversationStateRepository) {}

  async execute(input: {
    readonly userId: string;
    readonly expected: ConversationStatePrecondition;
  }): Promise<ConversationSnapshotCheck> {
    const state = await this.repository.findByUserId(input.userId);
    if (!state) return { status: 'missing' };
    if (getFinancialExecutionClaim(state.statePayload) !== null) {
      return { status: 'operation_in_progress' };
    }
    const expired = state.expiresAt !== null && state.expiresAt.getTime() <= Date.now();
    if (expired) return { status: 'expired' };
    if (
      state.revision !== input.expected.revision ||
      state.currentState !== input.expected.currentState ||
      input.expected.expiry === 'expired'
    ) {
      return { status: 'stale' };
    }
    return { status: 'current', state };
  }
}
