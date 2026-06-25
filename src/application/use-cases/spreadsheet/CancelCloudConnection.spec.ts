// LAYER: Application / Tests
// Unit tests for CancelCloudConnection use case.
// Mocks Redis, BullMQ Queue, TransitionConversationState, and MessagingOutputPort.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CancelCloudConnection,
  type CancelCloudConnectionDeps,
  type CancelCloudConnectionInput,
} from './CancelCloudConnection';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { onboardingCopies } from '../../copies/onboarding.copies';

const mockRedisGet = vi.fn();
const mockRedisDel = vi.fn();
const mockQueueRemove = vi.fn();
const mockTransitionExecute = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockLoggerError = vi.fn();

function buildMockDeps(
  overrides: Partial<CancelCloudConnectionDeps> = {},
): CancelCloudConnectionDeps {
  return {
    redis: { get: mockRedisGet, del: mockRedisDel } as unknown as Redis,
    reminderQueue: { remove: mockQueueRemove } as unknown as Queue,
    transitionState: { execute: mockTransitionExecute } as unknown as TransitionConversationState,
    messagingPort: { sendMessage: mockSendMessage },
    logger: { error: mockLoggerError } as unknown as Logger,
    ...overrides,
  };
}

const baseInput: CancelCloudConnectionInput = {
  userId: 'user-123',
  state: 'test-state-456',
  externalId: '987654321',
  channel: 'telegram',
};

const baseRedisPayload = JSON.stringify({
  userId: 'user-123',
  provider: 'google',
  externalId: '987654321',
  channel: 'telegram',
  reminderJobId: 'job-456',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CancelCloudConnection', () => {
  describe('valid cancellation', () => {
    it('deletes Redis state, cancels BullMQ job, transitions FSM to IDLE, and sends message', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockQueueRemove.mockResolvedValue(1);

      const deps = buildMockDeps();
      const useCase = new CancelCloudConnection(deps);
      const result = await useCase.execute(baseInput);

      expect(mockRedisGet).toHaveBeenCalledWith('oauth:state:test-state-456');
      expect(mockRedisDel).toHaveBeenCalledWith('oauth:state:test-state-456');
      expect(mockQueueRemove).toHaveBeenCalledWith('job-456');
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
        payload: null,
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.cancelledMessage(),
      );

      expect(result.nextState).toBe('IDLE');
      expect(result.message).toBe(onboardingCopies.cancelledMessage());
    });
  });

  describe('missing state in Redis', () => {
    it('still transitions to IDLE without crashing', async () => {
      mockRedisGet.mockResolvedValue(null);

      const deps = buildMockDeps();
      const useCase = new CancelCloudConnection(deps);
      const result = await useCase.execute(baseInput);

      expect(mockRedisDel).not.toHaveBeenCalled();
      expect(mockQueueRemove).not.toHaveBeenCalled();
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
        payload: null,
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.cancelledMessage(),
      );
      expect(result.nextState).toBe('IDLE');
    });
  });

  describe('BullMQ job cancellation failure', () => {
    it('logs the error but does not block cancellation', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockQueueRemove.mockRejectedValue(new Error('Job not found'));

      const deps = buildMockDeps();
      const useCase = new CancelCloudConnection(deps);
      const result = await useCase.execute(baseInput);

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'CancelCloudConnection',
          code: 'REMINDER_CANCEL_FAILED',
        }),
      );
      expect(mockRedisDel).toHaveBeenCalled();
      expect(mockTransitionExecute).toHaveBeenCalled();
      expect(result.nextState).toBe('IDLE');
    });
  });
});
