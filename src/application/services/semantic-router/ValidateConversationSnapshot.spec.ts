import { describe, expect, it, vi } from 'vitest';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import { ValidateConversationSnapshot } from './ValidateConversationSnapshot';

const state: ConversationState = {
  userId: 'user-1',
  revision: '2',
  currentState: 'IDLE',
  statePayload: null,
  enteredAt: new Date(),
  expiresAt: null,
  updatedAt: new Date(),
};

describe('ValidateConversationSnapshot', () => {
  it('returns current only for the same revision, state and live context', async () => {
    const repository = { findByUserId: vi.fn().mockResolvedValue(state) };
    const validator = new ValidateConversationSnapshot(repository as never);
    await expect(
      validator.execute({
        userId: 'user-1',
        expected: { revision: '2', currentState: 'IDLE', expiry: 'unexpired' },
      }),
    ).resolves.toEqual({ status: 'current', state });
  });

  it('detects stale, expired, missing and operation-in-progress snapshots', async () => {
    const repository = { findByUserId: vi.fn() };
    const validator = new ValidateConversationSnapshot(repository as never);
    const expected = { revision: '2', currentState: 'IDLE', expiry: 'unexpired' as const };
    repository.findByUserId.mockResolvedValue({ ...state, revision: '3' });
    await expect(validator.execute({ userId: 'user-1', expected })).resolves.toEqual({
      status: 'stale',
    });
    repository.findByUserId.mockResolvedValue({ ...state, expiresAt: new Date(0) });
    await expect(validator.execute({ userId: 'user-1', expected })).resolves.toEqual({
      status: 'expired',
    });
    repository.findByUserId.mockResolvedValue(null);
    await expect(validator.execute({ userId: 'user-1', expected })).resolves.toEqual({
      status: 'missing',
    });
    repository.findByUserId.mockResolvedValue({
      ...state,
      statePayload: {
        executionClaim: {
          claimId: 'claim',
          kind: 'save',
          operationId: 'operation',
          sourceMessageId: null,
          status: 'in_flight',
          target: {},
        },
      },
    });
    await expect(validator.execute({ userId: 'user-1', expected })).resolves.toEqual({
      status: 'operation_in_progress',
    });
  });
});
