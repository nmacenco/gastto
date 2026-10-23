// LAYER: Domain
export type ConversationDecision =
  | { action: 'register_expense' }
  | { action: 'cancel_current_flow' }
  | { action: 'correct_expense' }
  | { action: 'provide_missing_expense_data' }
  | { action: 'undo_last_expense' }
  | { action: 'select_option'; userReference: string }
  | { action: 'request_save_retry' }
  | { action: 'request_reconfiguration' }
  | {
      action: 'request_clarification';
      reason:
        | 'ambiguous_intent'
        | 'mixed_intents'
        | 'ambiguous_reference'
        | 'explicit_confirmation_required';
    }
  | { action: 'out_of_scope' };
