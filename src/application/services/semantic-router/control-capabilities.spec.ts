import { describe, expect, it } from 'vitest';
import { FSM_STATES } from '../../../domain/entities/ConversationState';
import {
  CONTROL_SEMANTIC_CAPABILITY_MATRIX,
  isControlCapabilityAllowed,
  isControlSemanticDecision,
  type SemanticControlProvenance,
} from './control-capabilities';

describe('control semantic capabilities', () => {
  it('accounts for every FSM state and exposes only the approved default matrix', () => {
    expect(Object.keys(CONTROL_SEMANTIC_CAPABILITY_MATRIX).sort()).toEqual([...FSM_STATES].sort());
    expect(CONTROL_SEMANTIC_CAPABILITY_MATRIX).toMatchObject({
      IDLE: { default: ['undo_last_expense'] },
      EXPENSE_RECEIVING: { default: ['cancel_current_flow'] },
      EXPENSE_CLARIFYING: { default: ['cancel_current_flow'] },
      EXPENSE_REVIEW: { default: ['cancel_current_flow'] },
      EXPENSE_CORRECTING: { default: ['cancel_current_flow'] },
      EXPENSE_SAVING_RETRY: {
        default: ['request_save_retry', 'request_reconfiguration'],
      },
      EXPENSE_UNDO_CONFIRMING: { default: [] },
    });
  });

  it.each([
    ['IDLE', null, 'undo_last_expense', true],
    ['EXPENSE_RECEIVING', null, 'cancel_current_flow', true],
    ['EXPENSE_CLARIFYING', null, 'cancel_current_flow', true],
    ['EXPENSE_REVIEW', null, 'cancel_current_flow', true],
    ['EXPENSE_CORRECTING', null, 'cancel_current_flow', true],
    ['EXPENSE_SAVING_RETRY', null, 'request_save_retry', true],
    ['EXPENSE_SAVING_RETRY', null, 'request_reconfiguration', true],
    ['EXPENSE_UNDO_CONFIRMING', null, 'undo_last_expense', false],
    ['EXPENSE_SAVING', null, 'cancel_current_flow', false],
    ['ONBOARDING_START', null, 'cancel_current_flow', false],
    ['IDLE', 'future-step', 'undo_last_expense', false],
    ['EXPENSE_CORRECTING', 'future-step', 'cancel_current_flow', false],
    ['EXPENSE_SAVING_RETRY', 'future-step', 'request_save_retry', false],
  ] as const)('%s/%s gates %s as %s', (state, substep, action, expected) => {
    expect(isControlCapabilityAllowed(state, substep, { action })).toBe(expected);
  });

  it('recognizes only control proposals and keeps provenance application-owned', () => {
    expect(isControlSemanticDecision({ action: 'cancel_current_flow' })).toBe(true);
    expect(isControlSemanticDecision({ action: 'register_expense' })).toBe(false);
    const provenance: SemanticControlProvenance = {
      kind: 'semantic_proposal',
      sourceMessageId: 'message-1',
    };
    expect(provenance).toEqual({ kind: 'semantic_proposal', sourceMessageId: 'message-1' });
  });
});
