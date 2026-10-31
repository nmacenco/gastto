import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { ConversationState, FsmState } from '../../../domain/entities/ConversationState';
import type {
  IMappingCorrectionStateRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import type { TransitionConversationState } from './TransitionConversationState';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { CancelConversationFlow } from './CancelConversationFlow';

function state(
  currentState: FsmState,
  statePayload: Record<string, unknown> | null = null,
): ConversationState {
  return {
    userId: 'user-1',
    revision: '8',
    currentState,
    statePayload,
    enteredAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    updatedAt: new Date(),
  };
}

function setup() {
  const events: string[] = [];
  const transition = vi.fn().mockImplementation(() => {
    events.push('transition');
    return Promise.resolve({ status: 'updated' });
  });
  const sendMessage = vi.fn().mockImplementation(() => {
    events.push('message');
    return Promise.resolve({ status: 'success' });
  });
  const findByUserId = vi.fn().mockResolvedValue({ categoriesConfirmedAt: null });
  const load = vi.fn().mockResolvedValue(null);
  const clear = vi.fn().mockResolvedValue(undefined);
  const cleanup = vi.fn().mockResolvedValue(undefined);
  const logger = { error: vi.fn() } as unknown as Logger;
  const useCase = new CancelConversationFlow({
    transitionState: {
      execute: transition,
      precondition: (observed: ConversationState, expiry: string) => ({
        revision: observed.revision,
        currentState: observed.currentState,
        expiry,
      }),
    } as unknown as TransitionConversationState,
    spreadsheetConfigRepository: { findByUserId } as unknown as ISpreadsheetConfigRepository,
    mappingCorrectionStateRepository: {
      load,
      clear,
    } as unknown as IMappingCorrectionStateRepository,
    cancelCloudConnection: { cleanup },
    logger,
  });
  const execute = (observed: ConversationState) =>
    useCase.execute({
      userId: 'user-1',
      externalId: 'chat-1',
      channel: 'telegram',
      state: observed,
      source: 'text',
      messagingPort: { sendMessage },
    });
  return { execute, transition, sendMessage, findByUserId, load, clear, cleanup, events };
}

describe('CancelConversationFlow', () => {
  it.each([
    'ONBOARDING_START',
    'ONBOARDING_DRIVE',
    'ONBOARDING_FILE',
    'ONBOARDING_SHEET',
    'ONBOARDING_VALIDATING_ACCESS',
    'ONBOARDING_MAPPING',
    'ONBOARDING_CATEGORIES',
  ] as const)('exits %s with an observed revision before responding', async (fsmState) => {
    const ctx = setup();
    const result = await ctx.execute(state(fsmState));
    expect(result).toEqual({ status: 'cancelled' });
    expect(ctx.transition).toHaveBeenCalledWith({
      userId: 'user-1',
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
      expected: { revision: '8', currentState: fsmState, expiry: 'any' },
    });
    expect(ctx.events).toEqual(['transition', 'message']);
    expect(ctx.sendMessage).toHaveBeenCalledWith('chat-1', onboardingCopies.flowCancelled(false));
  });

  it('cleans the OAuth nonce only after the guarded exit', async () => {
    const ctx = setup();
    await ctx.execute(state('ONBOARDING_DRIVE', { state: 'oauth-nonce' }));
    expect(ctx.cleanup).toHaveBeenCalledWith('oauth-nonce', 'user-1');
    expect(ctx.transition.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.cleanup.mock.invocationCallOrder[0]!,
    );
  });

  it('clears only the active proposal correction snapshot', async () => {
    const ctx = setup();
    ctx.load.mockResolvedValue({ proposalId: 'proposal-1', spreadsheetId: 'sheet-1' });
    await ctx.execute(
      state('ONBOARDING_MAPPING', { proposalId: 'proposal-1', spreadsheetId: 'sheet-1' }),
    );
    expect(ctx.clear).toHaveBeenCalledWith('user-1');

    ctx.clear.mockClear();
    ctx.load.mockResolvedValue({ proposalId: 'old-proposal', spreadsheetId: 'sheet-1' });
    await ctx.execute(
      state('ONBOARDING_MAPPING', { proposalId: 'proposal-1', spreadsheetId: 'sheet-1' }),
    );
    expect(ctx.clear).not.toHaveBeenCalled();
  });

  it('offers settings only when the stored destination is complete', async () => {
    const ctx = setup();
    ctx.findByUserId.mockResolvedValue({ categoriesConfirmedAt: new Date() });
    await ctx.execute(state('ONBOARDING_MAPPING'));
    expect(ctx.sendMessage).toHaveBeenCalledWith('chat-1', onboardingCopies.flowCancelled(true));
  });

  it('does not send success or clean external state when the transition is stale', async () => {
    const ctx = setup();
    ctx.transition.mockRejectedValue(new Error('stale'));
    await expect(ctx.execute(state('ONBOARDING_DRIVE', { state: 'nonce' }))).rejects.toThrow(
      'stale',
    );
    expect(ctx.cleanup).not.toHaveBeenCalled();
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  it('does not cancel a claimed financial operation or another flow', async () => {
    const ctx = setup();
    expect(await ctx.execute(state('IDLE'))).toEqual({ status: 'no_active_flow' });
    const claimed = state('ONBOARDING_MAPPING', {
      executionClaim: {
        claimId: 'claim-1',
        kind: 'save',
        operationId: 'operation-1',
        sourceMessageId: null,
        status: 'in_flight',
        target: {},
      },
    });
    expect(await ctx.execute(claimed)).toEqual({ status: 'operation_in_progress' });
    expect(ctx.transition).not.toHaveBeenCalled();
  });
});
