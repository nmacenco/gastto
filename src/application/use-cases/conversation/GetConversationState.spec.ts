// LAYER: Application / Tests
// Unit tests for GetConversationState use case.
// Pure application logic — no DB, no HTTP, no messaging.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetConversationState, type GetConversationStateInput } from './GetConversationState';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import type { ConversationState } from '../../../domain/entities/ConversationState';

const mockFindByUserId = vi.fn();

function buildMockRepo(
  overrides: Partial<IConversationStateRepository> = {},
): IConversationStateRepository {
  return {
    findByUserId: mockFindByUserId,
    create: vi.fn(),
    transition: vi.fn(),
    findExpired: vi.fn(),
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

describe('GetConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the conversation state when it exists', async () => {
    const state = buildConversationState({ currentState: 'EXPENSE_REVIEW' });
    mockFindByUserId.mockResolvedValue(state);

    const repo = buildMockRepo();
    const useCase = new GetConversationState(repo);
    const input: GetConversationStateInput = { userId: 'user-123' };

    const result = await useCase.execute(input);

    expect(result).toBe(state);
    expect(mockFindByUserId).toHaveBeenCalledWith('user-123');
  });

  it('returns null when the user has no conversation state', async () => {
    mockFindByUserId.mockResolvedValue(null);

    const repo = buildMockRepo();
    const useCase = new GetConversationState(repo);
    const input: GetConversationStateInput = { userId: 'user-456' };

    const result = await useCase.execute(input);

    expect(result).toBeNull();
    expect(mockFindByUserId).toHaveBeenCalledWith('user-456');
  });
});
