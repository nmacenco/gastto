// LAYER: Domain / Tests
// Unit tests for ConversationState FSM transitions.
// Pure TypeScript, zero mocks.

import { describe, it, expect } from 'vitest';
import { canTransition, FSM_TRANSITIONS, type FsmState } from './ConversationState';

describe('ConversationState FSM', () => {
  describe('canTransition', () => {
    it('allows ONBOARDING_MAPPING self-transition', () => {
      expect(canTransition('ONBOARDING_MAPPING', 'ONBOARDING_MAPPING')).toBe(true);
    });

    it('includes ONBOARDING_MAPPING in FSM_TRANSITIONS targets', () => {
      expect(FSM_TRANSITIONS['ONBOARDING_MAPPING']).toContain('ONBOARDING_MAPPING');
    });

    it('still allows ONBOARDING_MAPPING to transition to ONBOARDING_CATEGORIES', () => {
      expect(canTransition('ONBOARDING_MAPPING', 'ONBOARDING_CATEGORIES')).toBe(true);
    });

    it('rejects invalid transitions from ONBOARDING_MAPPING', () => {
      expect(canTransition('ONBOARDING_MAPPING', 'EXPENSE_RECEIVING')).toBe(false);
      expect(canTransition('ONBOARDING_MAPPING', 'IDLE')).toBe(false);
    });

    it.each([
      ['IDLE', 'ONBOARDING_START'],
      ['IDLE', 'EXPENSE_RECEIVING'],
      ['ONBOARDING_START', 'ONBOARDING_START'],
      ['ONBOARDING_START', 'ONBOARDING_DRIVE'],
      ['ONBOARDING_DRIVE', 'ONBOARDING_FILE'],
      ['ONBOARDING_DRIVE', 'ONBOARDING_DRIVE'],
      ['ONBOARDING_DRIVE', 'IDLE'],
      ['ONBOARDING_FILE', 'ONBOARDING_FILE'],
      ['ONBOARDING_FILE', 'ONBOARDING_SHEET'],
      ['ONBOARDING_FILE', 'ONBOARDING_START'],
      ['ONBOARDING_SHEET', 'ONBOARDING_SHEET'],
      ['ONBOARDING_SHEET', 'ONBOARDING_VALIDATING_ACCESS'],
      ['ONBOARDING_SHEET', 'ONBOARDING_START'],
      ['ONBOARDING_VALIDATING_ACCESS', 'ONBOARDING_MAPPING'],
      ['ONBOARDING_VALIDATING_ACCESS', 'ONBOARDING_SHEET'],
      ['ONBOARDING_VALIDATING_ACCESS', 'ONBOARDING_START'],
      ['ONBOARDING_MAPPING', 'ONBOARDING_START'],
      ['ONBOARDING_CATEGORIES', 'IDLE'],
      ['ONBOARDING_CATEGORIES', 'ONBOARDING_CATEGORIES'],
      ['EXPENSE_RECEIVING', 'EXPENSE_CLARIFYING'],
      ['EXPENSE_RECEIVING', 'EXPENSE_REVIEW'],
      ['EXPENSE_RECEIVING', 'IDLE'],
      ['EXPENSE_CLARIFYING', 'EXPENSE_REVIEW'],
      ['EXPENSE_REVIEW', 'EXPENSE_REVIEW'],
      ['EXPENSE_CLARIFYING', 'IDLE'],
      ['EXPENSE_REVIEW', 'EXPENSE_SAVING'],
      ['EXPENSE_REVIEW', 'EXPENSE_CORRECTING'],
      ['EXPENSE_REVIEW', 'IDLE'],
      ['EXPENSE_CORRECTING', 'EXPENSE_REVIEW'],
      ['EXPENSE_CORRECTING', 'IDLE'],
      ['EXPENSE_SAVING', 'IDLE'],
      ['EXPENSE_SAVING', 'EXPENSE_SAVING_RETRY'],
      ['EXPENSE_SAVING_RETRY', 'IDLE'],
    ] as const)('allows %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });

    it.each([
      ['IDLE', 'EXPENSE_SAVING'],
      ['IDLE', 'ONBOARDING_MAPPING'],
      ['EXPENSE_SAVING', 'EXPENSE_RECEIVING'],
    ] as const)('rejects %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    });
  });

  describe('FSM_TRANSITIONS completeness', () => {
    it('defines transitions for every FSM state', () => {
      const allStates: FsmState[] = [
        'IDLE',
        'ONBOARDING_START',
        'ONBOARDING_DRIVE',
        'ONBOARDING_FILE',
        'ONBOARDING_SHEET',
        'ONBOARDING_VALIDATING_ACCESS',
        'ONBOARDING_MAPPING',
        'ONBOARDING_CATEGORIES',
        'EXPENSE_RECEIVING',
        'EXPENSE_CLARIFYING',
        'EXPENSE_REVIEW',
        'EXPENSE_CORRECTING',
        'EXPENSE_SAVING',
        'EXPENSE_SAVING_RETRY',
      ];

      for (const state of allStates) {
        expect(FSM_TRANSITIONS[state]).toBeDefined();
        expect(Array.isArray(FSM_TRANSITIONS[state])).toBe(true);
      }
    });
  });
});
