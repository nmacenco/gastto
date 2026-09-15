// LAYER: Application. Pure description of the existing deterministic route.
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { ClassifyFreeTextExpenseIntent } from '../../use-cases/conversation/ClassifyFreeTextExpenseIntent';
import { isCancelIntent, isConfirmIntent, isUndoIntent } from '../../utils/intents';

export type DeterministicRoutingDecision =
  | { readonly kind: 'fsm_handler' }
  | { readonly kind: 'expense_guidance' }
  | { readonly kind: 'typed_callback' }
  | {
      readonly kind: 'sensitive_command';
      readonly command: 'save' | 'retry' | 'undo' | 'cancel';
    }
  | { readonly kind: 'unsupported' };

export interface DeterministicRoutingPolicy {
  decide(input: {
    readonly state: FsmState;
    readonly rawMessage: string;
    readonly hasCallback: boolean;
  }): DeterministicRoutingDecision;
}

export class CurrentDeterministicRoutingPolicy implements DeterministicRoutingPolicy {
  constructor(private readonly classifier: ClassifyFreeTextExpenseIntent) {}

  decide(input: {
    readonly state: FsmState;
    readonly rawMessage: string;
    readonly hasCallback: boolean;
  }): DeterministicRoutingDecision {
    if (input.hasCallback) return { kind: 'typed_callback' };
    if (input.state === 'IDLE' && isUndoIntent(input.rawMessage)) {
      return { kind: 'sensitive_command', command: 'undo' };
    }
    if (isCancelIntent(input.rawMessage)) {
      return { kind: 'sensitive_command', command: 'cancel' };
    }
    if (input.state === 'EXPENSE_REVIEW' && isConfirmIntent(input.rawMessage)) {
      return { kind: 'sensitive_command', command: 'save' };
    }
    if (
      input.state === 'EXPENSE_SAVING_RETRY' &&
      input.rawMessage.toLocaleLowerCase('es-AR').trim() === 'reintentar'
    ) {
      return { kind: 'sensitive_command', command: 'retry' };
    }
    if (input.state === 'IDLE' || input.state === 'EXPENSE_RECEIVING') {
      const intent = this.classifier.execute(input.rawMessage);
      if (intent.kind === 'non-financial' && !isCancelIntent(input.rawMessage)) {
        return { kind: 'expense_guidance' };
      }
    }
    return { kind: 'fsm_handler' };
  }
}
