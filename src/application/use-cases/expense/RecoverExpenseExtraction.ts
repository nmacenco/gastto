// LAYER: Application
import type { ConversationState } from '../../../domain/entities/ConversationState';
import { getFinancialExecutionClaim } from '../../../domain/entities/ConversationState';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';
import type { LLMExtractionErrorCode } from '../../../domain/errors/LLMExtractionError';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';

/** Sent to the interface only after the failed initial attempt was reset. */
export class RecoveredExpenseExtractionError extends Error {
  constructor(public readonly code: LLMExtractionErrorCode) {
    super(code);
    this.name = 'RecoveredExpenseExtractionError';
  }
}

export class RecoverExpenseExtraction {
  constructor(private readonly transitionState: TransitionConversationState) {}

  async execute(observed: ConversationState): Promise<'recovered' | 'stale'> {
    const current = this.transitionState.currentState(observed.userId);
    if (
      !current ||
      current.revision !== observed.revision ||
      current.currentState !== 'EXPENSE_RECEIVING' ||
      getFinancialExecutionClaim(current.statePayload) !== null
    ) {
      return 'stale';
    }
    try {
      await this.transitionState.execute({
        userId: observed.userId,
        targetState: 'IDLE',
        payload: null,
        expiresAt: null,
        expected: this.transitionState.precondition(observed),
      });
      return 'recovered';
    } catch (error) {
      if (error instanceof StaleConversationStateError) return 'stale';
      throw error;
    }
  }
}
