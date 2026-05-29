// LAYER: Application / Tests
// Unit tests for RecoverCorruptedState use case.
// Pure application logic — no DB, no HTTP, no messaging.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecoverCorruptedState } from './RecoverCorruptedState';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import type { IOperationLogRepository } from '../../../domain/ports/repositories';
import type { OperationLog } from '../../../domain/entities/OperationLog';
import type { ConversationState } from '../../../domain/entities/ConversationState';

const mockFindByUserId = vi.fn();
const mockCreateState = vi.fn();
const mockTransition = vi.fn();
const mockFindExpired = vi.fn();
const mockLogCreate = vi.fn();

function buildMockConversationRepo(
  overrides: Partial<IConversationStateRepository> = {},
): IConversationStateRepository {
  return {
    findByUserId: mockFindByUserId,
    create: mockCreateState,
    transition: mockTransition,
    findExpired: mockFindExpired,
    ...overrides,
  };
}

function buildMockLogRepo(
  overrides: Partial<IOperationLogRepository> = {},
): IOperationLogRepository {
  return {
    create: mockLogCreate,
    ...overrides,
  };
}

function buildOperationLog(overrides: Partial<OperationLog> = {}): OperationLog {
  return {
    id: 'log-123',
    userId: 'user-123',
    operation: 'STATE_CORRUPTED',
    payload: null,
    errorType: 'CORRUPTED_STATE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
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

describe('RecoverCorruptedState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogCreate.mockResolvedValue(buildOperationLog());
    mockTransition.mockResolvedValue(buildConversationState());
  });

  it('detects invalid state, logs anomaly, resets to IDLE, and returns recovery message', async () => {
    const conversationRepo = buildMockConversationRepo();
    const logRepo = buildMockLogRepo();
    const useCase = new RecoverCorruptedState(conversationRepo, logRepo);

    const result = await useCase.execute({
      userId: 'user-123',
      observedState: 'INVALID_STATE',
    });

    expect(result.recovered).toBe(true);
    expect(result.message).toBe('Parece que algo falló. Vamos a empezar de nuevo.');

    expect(mockLogCreate).toHaveBeenCalledWith(
      'user-123',
      'STATE_CORRUPTED',
      { observedState: 'INVALID_STATE' },
      'CORRUPTED_STATE',
    );
    expect(mockTransition).toHaveBeenCalledWith('user-123', 'IDLE', null, null);
  });

  it('returns empty message and recovered=false when state is valid', async () => {
    const conversationRepo = buildMockConversationRepo();
    const logRepo = buildMockLogRepo();
    const useCase = new RecoverCorruptedState(conversationRepo, logRepo);

    const result = await useCase.execute({
      userId: 'user-123',
      observedState: 'IDLE',
    });

    expect(result.recovered).toBe(false);
    expect(result.message).toBe('');
    expect(mockLogCreate).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('handles edge-case valid states correctly', async () => {
    const conversationRepo = buildMockConversationRepo();
    const logRepo = buildMockLogRepo();
    const useCase = new RecoverCorruptedState(conversationRepo, logRepo);

    const result = await useCase.execute({
      userId: 'user-123',
      observedState: 'EXPENSE_SAVING_RETRY',
    });

    expect(result.recovered).toBe(false);
    expect(mockLogCreate).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });
});
