import type { SemanticRouterInput } from '../../../domain/ports/SemanticRouterPort';
import { FreeTextIntent } from '../../../domain/value-objects/FreeTextIntent';
import { isCancelIntent, isConfirmIntent, isUndoIntent } from '../../utils/intents';

export type BaselineObservation =
  | {
      status: 'observed';
      provenance: 'current_lexical_execution';
      outcome: 'guidance' | 'enqueued' | 'confirm' | 'cancel';
    }
  | { status: 'not_evaluated'; reason: 'model_dependent' | 'unsupported_scope' };

// Observes the actual pure ingress filter, NOT a synthetic end-to-end semantic action.
export function observeLexicalBaseline(input: SemanticRouterInput): BaselineObservation {
  if (input.substep !== null) return { status: 'not_evaluated', reason: 'unsupported_scope' };
  if (input.state === 'IDLE' || input.state === 'EXPENSE_RECEIVING') {
    const guidance =
      FreeTextIntent.fromText(input.rawMessage).kind === 'non-financial' &&
      !isCancelIntent(input.rawMessage) &&
      !isUndoIntent(input.rawMessage);
    return {
      status: 'observed',
      provenance: 'current_lexical_execution',
      outcome: guidance ? 'guidance' : 'enqueued',
    };
  }
  if (input.state === 'EXPENSE_REVIEW') {
    // A pending queued-review undo token isn't projected into evaluator inputs.
    if (isUndoIntent(input.rawMessage))
      return { status: 'not_evaluated', reason: 'unsupported_scope' };
    if (isConfirmIntent(input.rawMessage))
      return { status: 'observed', provenance: 'current_lexical_execution', outcome: 'confirm' };
    if (isCancelIntent(input.rawMessage))
      return { status: 'observed', provenance: 'current_lexical_execution', outcome: 'cancel' };
    return { status: 'not_evaluated', reason: 'model_dependent' };
  }
  return { status: 'not_evaluated', reason: 'unsupported_scope' };
}
