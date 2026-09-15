// LAYER: Application. Allowlisted projection of persisted state into untrusted model input.
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { SemanticRouterInput } from '../../../domain/ports/SemanticRouterPort';
import { SemanticRouterInputSchema } from './contracts';
import { allowedActionsFor } from './policy';

export type SemanticInputProjection =
  | { readonly status: 'supported'; readonly input: SemanticRouterInput }
  | {
      readonly status: 'unsupported';
      readonly code: 'UNSUPPORTED_STATE' | 'UNSUPPORTED_SUBSTEP' | 'INVALID_STATE_CONTEXT';
    };

export class ProjectSemanticRouterInput {
  execute(input: {
    readonly rawMessage: string;
    readonly conversationState: ConversationState;
  }): SemanticInputProjection {
    const { conversationState } = input;
    if (
      conversationState.currentState !== 'IDLE' &&
      conversationState.currentState !== 'EXPENSE_RECEIVING'
    ) {
      return { status: 'unsupported', code: 'UNSUPPORTED_STATE' };
    }
    const allowedActions = allowedActionsFor(conversationState.currentState, null);
    if (!allowedActions) return { status: 'unsupported', code: 'UNSUPPORTED_SUBSTEP' };

    const projected: SemanticRouterInput = {
      rawMessage: input.rawMessage,
      state: conversationState.currentState,
      substep: null,
      allowedActions,
      context: { pendingQuestion: null, missingFields: [], expense: null, options: [] },
    };
    const parsed = SemanticRouterInputSchema.safeParse(projected);
    return parsed.success
      ? { status: 'supported', input: parsed.data }
      : { status: 'unsupported', code: 'INVALID_STATE_CONTEXT' };
  }
}
