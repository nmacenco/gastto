// LAYER: Application / Tests
// Unit tests for SendOAuthReminder use case.
// Mocks OAuthServicePort, IOAuthTokenRepository, Redis, BullMQ Queue,
// TransitionConversationState, and MessagingOutputPort.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SendOAuthReminder,
  type SendOAuthReminderDeps,
  type SendOAuthReminderInput,
} from './SendOAuthReminder';
import type { IOAuthTokenRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { Redis } from 'ioredis';
import type { Queue, Job } from 'bullmq';
import { onboardingCopies } from '../../copies/onboarding.copies';

const mockBuildAuthUrl = vi.fn();
const mockTokenFind = vi.fn();
const mockRedisSetex = vi.fn().mockResolvedValue('OK');
const mockQueueAdd = vi.fn();
const mockTransitionExecute = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });

function buildMockDeps(overrides: Partial<SendOAuthReminderDeps> = {}): SendOAuthReminderDeps {
  return {
    redis: { setex: mockRedisSetex } as unknown as Redis,
    oauthService: {
      buildAuthUrl: mockBuildAuthUrl,
      exchangeCode: vi.fn(),
    },
    tokenRepository: { findByUserAndProvider: mockTokenFind } as unknown as IOAuthTokenRepository,
    reminderQueue: { add: mockQueueAdd } as unknown as Queue,
    transitionState: { execute: mockTransitionExecute } as unknown as TransitionConversationState,
    messagingPort: { sendMessage: mockSendMessage },
    generateState: () => 'fresh-state-789',
    ...overrides,
  };
}

const baseInput: SendOAuthReminderInput = {
  userId: 'user-123',
  externalId: '987654321',
  channel: 'telegram',
  provider: 'google',
  redirectUri: 'http://localhost:3000/auth/google/callback',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildAuthUrl.mockReturnValue(
    'https://accounts.google.com/o/oauth2/v2/auth?state=fresh-state-789',
  );
  mockQueueAdd.mockResolvedValue({ id: 'job-789' } as Job);
});

describe('SendOAuthReminder', () => {
  describe('reminder sent with fresh state', () => {
    it('generates new state, stores in Redis, schedules job, updates FSM payload, and sends message', async () => {
      mockTokenFind.mockResolvedValue(null);

      const deps = buildMockDeps();
      const useCase = new SendOAuthReminder(deps);
      const result = await useCase.execute(baseInput);

      expect(mockTokenFind).toHaveBeenCalledWith('user-123', 'google');
      expect(mockBuildAuthUrl).toHaveBeenCalledWith(
        'google',
        'fresh-state-789',
        'http://localhost:3000/auth/google/callback',
      );
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'oauth-reminder',
        { userId: 'user-123', externalId: '987654321', channel: 'telegram' },
        { delay: 600000 },
      );
      expect(mockRedisSetex).toHaveBeenCalledWith(
        'oauth:state:fresh-state-789',
        900,
        JSON.stringify({
          userId: 'user-123',
          provider: 'google',
          externalId: '987654321',
          channel: 'telegram',
          reminderJobId: 'job-789',
        }),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_DRIVE',
        payload: { provider: 'google', state: 'fresh-state-789' },
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reminderMessage(
          'https://accounts.google.com/o/oauth2/v2/auth?state=fresh-state-789',
        ),
      );

      expect(result.nextState).toBe('ONBOARDING_DRIVE');
      expect(result.message).toBe(
        onboardingCopies.reminderMessage(
          'https://accounts.google.com/o/oauth2/v2/auth?state=fresh-state-789',
        ),
      );
    });
  });

  describe('tokens already exist', () => {
    it('skips reminder and returns empty message with no side effects', async () => {
      mockTokenFind.mockResolvedValue({ id: 'token-123' });

      const deps = buildMockDeps();
      const useCase = new SendOAuthReminder(deps);
      const result = await useCase.execute(baseInput);

      expect(result.message).toBe('');
      expect(result.nextState).toBe('ONBOARDING_DRIVE');
      expect(mockBuildAuthUrl).not.toHaveBeenCalled();
      expect(mockQueueAdd).not.toHaveBeenCalled();
      expect(mockRedisSetex).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('fallback job id when BullMQ returns undefined id', () => {
    it('uses a fallback job id when BullMQ job id is missing', async () => {
      mockTokenFind.mockResolvedValue(null);
      mockQueueAdd.mockResolvedValue({ id: undefined });

      const deps = buildMockDeps();
      const useCase = new SendOAuthReminder(deps);
      await useCase.execute(baseInput);

      const redisCallArgs = mockRedisSetex.mock.calls[0] as [string, number, string];
      expect(redisCallArgs).toBeDefined();
      const storedValue = JSON.parse(redisCallArgs[2]) as { reminderJobId: string };
      expect(storedValue.reminderJobId).toMatch(/^fallback-\d+$/);
    });
  });

  describe('buildAuthUrl failure', () => {
    it('propagates error and performs no side effects', async () => {
      mockTokenFind.mockResolvedValue(null);
      mockBuildAuthUrl.mockImplementation(() => {
        throw new Error('Invalid provider');
      });

      const deps = buildMockDeps();
      const useCase = new SendOAuthReminder(deps);

      await expect(useCase.execute(baseInput)).rejects.toThrow('Invalid provider');

      expect(mockQueueAdd).not.toHaveBeenCalled();
      expect(mockRedisSetex).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('BullMQ queue.add failure', () => {
    it('propagates error and does not call Redis, transition, or messaging', async () => {
      mockTokenFind.mockResolvedValue(null);
      mockQueueAdd.mockRejectedValue(new Error('Queue unreachable'));

      const deps = buildMockDeps();
      const useCase = new SendOAuthReminder(deps);

      await expect(useCase.execute(baseInput)).rejects.toThrow('Queue unreachable');

      expect(mockRedisSetex).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
});
