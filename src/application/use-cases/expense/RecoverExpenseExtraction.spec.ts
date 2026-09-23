import { describe, expect, it, vi } from 'vitest';
import { RecoverExpenseExtraction } from './RecoverExpenseExtraction';
import { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import type { ConversationState } from '../../../domain/entities/ConversationState';

function setup() {
  const observed: ConversationState = {
    userId: 'user',
    revision: '5',
    currentState: 'EXPENSE_RECEIVING',
    statePayload: { raw_message: 'almuerzo 200 euros' },
    expiresAt: null,
    enteredAt: new Date(),
    updatedAt: new Date(),
  };
  const transition = vi.fn().mockResolvedValue({
    status: 'updated',
    state: { ...observed, revision: '6', currentState: 'IDLE', statePayload: null },
  });
  const repo: IConversationStateRepository = {
    transition,
    findByUserId: vi.fn(),
    create: vi.fn(),
    findExpired: vi.fn(),
  };
  const state = new TransitionConversationState(repo);
  return { observed, transition, state, recover: new RecoverExpenseExtraction(state) };
}

describe('RecoverExpenseExtraction', () => {
  it('resets only the owned receiving revision and clears the failed draft', async () => {
    const h = setup();
    await h.state.runWithState(h.observed, async () => {
      expect(await h.recover.execute(h.observed)).toBe('recovered');
      expect(h.state.currentState('user')?.currentState).toBe('IDLE');
    });
    expect(h.transition).toHaveBeenCalledWith({
      userId: 'user',
      expected: { revision: '5', currentState: 'EXPENSE_RECEIVING', expiry: 'any' },
      nextState: 'IDLE',
      payload: null,
      expiresAt: null,
    });
  });

  it.each(['EXPENSE_REVIEW', 'EXPENSE_SAVING', 'EXPENSE_CLARIFYING'] as const)(
    'preserves a later %s state',
    async (currentState) => {
      const h = setup();
      await h.state.runWithState({ ...h.observed, revision: '6', currentState }, async () => {
        expect(await h.recover.execute(h.observed)).toBe('stale');
      });
      expect(h.transition).not.toHaveBeenCalled();
    },
  );

  it('does not reset after ownership loss or outside the owned context', async () => {
    const h = setup();
    expect(await h.recover.execute(h.observed)).toBe('stale');
    await h.state.runWithState(h.observed, async () => {
      h.state.invalidateExecution('user');
      expect(await h.recover.execute(h.observed)).toBe('stale');
    });
    expect(h.transition).not.toHaveBeenCalled();
  });

  it('does not erase an unresolved financial claim even on an inconsistent receiving state', async () => {
    const h = setup();
    h.observed.statePayload = {
      executionClaim: {
        claimId: 'claim',
        kind: 'save',
        operationId: 'op',
        sourceMessageId: null,
        status: 'outcome_unknown',
        target: {},
      },
    };
    await h.state.runWithState(h.observed, async () => {
      expect(await h.recover.execute(h.observed)).toBe('stale');
    });
    expect(h.transition).not.toHaveBeenCalled();
  });

  it('treats a database compare-and-swap conflict as stale', async () => {
    const h = setup();
    h.transition.mockResolvedValue({ status: 'stale' });
    await h.state.runWithState(h.observed, async () => {
      expect(await h.recover.execute(h.observed)).toBe('stale');
    });
  });

  it('propagates persistence failure without claiming recovery', async () => {
    const h = setup();
    h.transition.mockRejectedValue(new Error('database unavailable'));
    await expect(
      h.state.runWithState(h.observed, () => h.recover.execute(h.observed)),
    ).rejects.toThrow('database unavailable');
  });
});
