// LAYER: Application / Tests
// Unit tests for TransitionConversationState use case.
// Pure application logic — no DB, no HTTP, no messaging.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TransitionConversationState,
  type TransitionConversationStateInput,
} from './TransitionConversationState';
import { InvalidStateTransitionError } from '../../../domain/errors/InvalidStateTransitionError';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';

const mockFindByUserId = vi.fn();
const mockCreate = vi.fn();
const mockTransition = vi.fn();
const mockFindExpired = vi.fn();

function buildMockRepo(
  overrides: Partial<IConversationStateRepository> = {},
): IConversationStateRepository {
  return {
    findByUserId: mockFindByUserId,
    create: mockCreate,
    transition: mockTransition,
    findExpired: mockFindExpired,
    ...overrides,
  };
}

function buildConversationState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    userId: 'user-123',
    revision: '0',
    currentState: 'IDLE',
    statePayload: null,
    enteredAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('TransitionConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows valid transition and delegates to repository', async () => {
    const currentState = buildConversationState({ currentState: 'IDLE' });
    const nextState = buildConversationState({ currentState: 'EXPENSE_RECEIVING' });
    mockFindByUserId.mockResolvedValue(currentState);
    mockTransition.mockResolvedValue({ status: 'updated', state: nextState });

    const repo = buildMockRepo();
    const useCase = new TransitionConversationState(repo);
    const input: TransitionConversationStateInput = {
      userId: 'user-123',
      targetState: 'EXPENSE_RECEIVING',
      payload: { rawMessage: 'test' },
      expiresAt: new Date('2026-12-31T23:59:59Z'),
      expected: { revision: '0', currentState: 'IDLE', expiry: 'any' },
    };

    const result = await useCase.execute(input);

    expect(result).toEqual({ status: 'updated', state: nextState });
    expect(mockTransition).toHaveBeenCalledWith({
      userId: 'user-123',
      expected: { revision: '0', currentState: 'IDLE', expiry: 'any' },
      nextState: 'EXPENSE_RECEIVING',
      payload: { rawMessage: 'test' },
      expiresAt: new Date('2026-12-31T23:59:59Z'),
    });
  });

  it('allows category-stage reconnection through the strict transition boundary', async () => {
    const currentState = buildConversationState({ currentState: 'ONBOARDING_CATEGORIES' });
    const nextState = buildConversationState({
      currentState: 'ONBOARDING_START',
      statePayload: { promptShown: true },
    });
    mockFindByUserId.mockResolvedValue(currentState);
    mockTransition.mockResolvedValue({ status: 'updated', state: nextState });

    const repo = buildMockRepo();
    const useCase = new TransitionConversationState(repo);

    const result = await useCase.execute({
      userId: 'user-123',
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
      expected: { revision: '0', currentState: 'ONBOARDING_CATEGORIES', expiry: 'any' },
    });

    expect(result).toEqual({ status: 'updated', state: nextState });
    expect(mockTransition).toHaveBeenCalledWith({
      userId: 'user-123',
      expected: { revision: '0', currentState: 'ONBOARDING_CATEGORIES', expiry: 'any' },
      nextState: 'ONBOARDING_START',
      payload: { promptShown: true },
      expiresAt: null,
    });
  });

  it('throws InvalidStateTransitionError for invalid transition', async () => {
    const currentState = buildConversationState({ currentState: 'IDLE' });
    mockFindByUserId.mockResolvedValue(currentState);

    const repo = buildMockRepo();
    const useCase = new TransitionConversationState(repo);

    await expect(
      useCase.execute({
        userId: 'user-123',
        targetState: 'EXPENSE_SAVING',
        expected: { revision: '0', currentState: 'IDLE', expiry: 'any' },
      }),
    ).rejects.toThrow(InvalidStateTransitionError);

    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('uses the explicitly observed IDLE precondition without refetching', async () => {
    const nextState = buildConversationState({ currentState: 'ONBOARDING_START' });
    mockFindByUserId.mockResolvedValue(null);
    mockTransition.mockResolvedValue({ status: 'updated', state: nextState });

    const repo = buildMockRepo();
    const useCase = new TransitionConversationState(repo);
    const result = await useCase.execute({
      userId: 'user-123',
      targetState: 'ONBOARDING_START',
      expected: { revision: '0', currentState: 'IDLE', expiry: 'any' },
    });

    expect(result).toEqual({ status: 'updated', state: nextState });
  });

  it('throws InvalidStateTransitionError when transitioning from IDLE to invalid state', async () => {
    mockFindByUserId.mockResolvedValue(null);

    const repo = buildMockRepo();
    const useCase = new TransitionConversationState(repo);

    await expect(
      useCase.execute({
        userId: 'user-123',
        targetState: 'EXPENSE_CORRECTING',
        expected: { revision: '0', currentState: 'IDLE', expiry: 'any' },
      }),
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  it('uses the active ALS snapshot when expected is omitted inside owned execution', async () => {
    const observed = buildConversationState({
      revision: '7',
      currentState: 'EXPENSE_REVIEW',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const updated = buildConversationState({ revision: '8', currentState: 'EXPENSE_CORRECTING' });
    mockTransition.mockResolvedValue({ status: 'updated', state: updated });
    const useCase = new TransitionConversationState(buildMockRepo());

    await useCase.runWithState(observed, () =>
      useCase.execute({ userId: observed.userId, targetState: 'EXPENSE_CORRECTING' }),
    );

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: { revision: '7', currentState: 'EXPENSE_REVIEW', expiry: 'unexpired' },
      }),
    );
  });

  it('rejects an explicit write after the owned execution was invalidated', async () => {
    const observed = buildConversationState({ currentState: 'EXPENSE_REVIEW' });
    const useCase = new TransitionConversationState(buildMockRepo());

    await expect(
      useCase.runWithState(observed, async () => {
        useCase.invalidateExecution(observed.userId);
        return useCase.execute({
          userId: observed.userId,
          targetState: 'EXPENSE_CORRECTING',
          expected: useCase.precondition(observed),
        });
      }),
    ).rejects.toBeInstanceOf(StaleConversationStateError);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('invalidates every parallel owned context for the same user', async () => {
    const observed = buildConversationState();
    const useCase = new TransitionConversationState(buildMockRepo());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = useCase.runWithState(observed, async () => {
      await gate;
      useCase.assertExecutionIsValid(observed.userId);
    });
    const second = useCase.runWithState(observed, async () => {
      await gate;
      useCase.assertExecutionIsValid(observed.userId);
    });

    await Promise.resolve();
    useCase.invalidateExecution(observed.userId);
    release();

    await expect(first).rejects.toBeInstanceOf(StaleConversationStateError);
    await expect(second).rejects.toBeInstanceOf(StaleConversationStateError);
  });
});
