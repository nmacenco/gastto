import { describe, expect, it } from 'vitest';
import type { ConversationState } from '../../domain/entities/ConversationState';
import { readRecoveryState, resolveRecoveryContext } from './recovery-context';
import { expenseCopies, recoveryGuidance } from '../copies/expense.copies';

const state = (
  currentState: string,
  statePayload: Record<string, unknown> | null = null,
): ConversationState => ({
  userId: 'user',
  revision: '2',
  currentState: currentState as ConversationState['currentState'],
  statePayload,
  enteredAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
});
describe('recovery eligibility', () => {
  it.each([
    'ONBOARDING_FILE',
    'ONBOARDING_SHEET',
    'ONBOARDING_MAPPING',
    'SETTINGS_MENU',
    'SETTINGS_CATEGORIES',
    'EXPENSE_CLARIFYING',
    'EXPENSE_CORRECTING',
    'EXPENSE_REVIEW',
    'EXPENSE_SAVING_RETRY',
  ])('offers an exit for an unclaimed %s', (name) => {
    const context = resolveRecoveryContext(state(name));
    expect(context).toBe('cancellable');
    expect(recoveryGuidance({ action: 'Continuá con el último paso.' }, context)).toContain(
      '\n\nEscribí cancelar si quieres salir.',
    );
  });
  it.each(['save', 'retry', 'undo'])(
    'does not offer cancellation or retry for claimed %s',
    (kind) => {
      const claimed = state('EXPENSE_SAVING', {
        executionClaim: {
          claimId: 'claim',
          operationId: 'operation',
          sourceMessageId: null,
          kind,
          status: 'outcome_unknown',
          target: {},
        },
      });
      const context = resolveRecoveryContext(claimed);
      expect(context).toBe('financially-blocked');
      expect(expenseCopies.fallbackError(context)).toBe(expenseCopies.financialOutcomeUnknown());
    },
  );
  it('does not offer exits for idle, unknown, expired or failed lookups', async () => {
    const expired = { ...state('EXPENSE_REVIEW'), expiresAt: new Date(0) };
    for (const current of [
      null,
      undefined,
      state('IDLE'),
      state('invalid'),
      expired,
      await readRecoveryState(() => Promise.reject(new Error('db'))),
    ]) {
      expect(expenseCopies.fallbackError(resolveRecoveryContext(current))).not.toContain(
        'cancelar',
      );
    }
  });
});
