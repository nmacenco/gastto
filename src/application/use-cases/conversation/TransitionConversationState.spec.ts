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
    mockTransition.mockResolvedValue(nextState);

    const repo = buildMockRepo();
    const useCase = new TransitionConversationState(repo);
    const input: TransitionConversationStateInput = {
      userId: 'user-123',
      targetState: 'EXPENSE_RECEIVING',
      payload: { rawMessage: 'test' },
      expiresAt: new Date('2026-12-31T23:59:59Z'),
    };

    const result = await useCase.execute(input);

    expect(result).toBe(nextState);
    expect(mockTransition).toHaveBeenCalledWith(
      'user-123',
      'EXPENSE_RECEIVING',
      { rawMessage: 'test' },
      new Date('2026-12-31T23:59:59Z'),
    );
  });

  it('throws InvalidStateTransitionError for invalid transition', async () => {
    const currentState = buildConversationState({ currentState: 'IDLE' });
    mockFindByUserId.mockResolvedValue(currentState);

    const repo = buildMockRepo();
    const useCase = new TransitionConversationState(repo);

    await expect(
      useCase.execute({ userId: 'user-123', targetState: 'EXPENSE_SAVING' }),
    ).rejects.toThrow(InvalidStateTransitionError);

    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('treats missing current state as IDLE and validates from IDLE', async () => {
    const nextState = buildConversationState({ currentState: 'ONBOARDING_START' });
    mockFindByUserId.mockResolvedValue(null);
    mockTransition.mockResolvedValue(nextState);

    const repo = buildMockRepo();
    const useCase = new TransitionConversationState(repo);
    const result = await useCase.execute({
      userId: 'user-123',
      targetState: 'ONBOARDING_START',
    });

    expect(result).toBe(nextState);
    expect(mockTransition).toHaveBeenCalledWith('user-123', 'ONBOARDING_START', null, null);
  });

  it('throws InvalidStateTransitionError when transitioning from IDLE to invalid state', async () => {
    mockFindByUserId.mockResolvedValue(null);

    const repo = buildMockRepo();
    const useCase = new TransitionConversationState(repo);

    await expect(
      useCase.execute({ userId: 'user-123', targetState: 'EXPENSE_CORRECTING' }),
    ).rejects.toThrow(InvalidStateTransitionError);
  });
});
