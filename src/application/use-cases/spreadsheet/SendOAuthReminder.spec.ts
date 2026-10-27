// LAYER: Application / Tests
// Unit tests for SendOAuthReminder use case.
// Mocks OAuthServicePort, OAuthAccessTokenProvider, Redis, BullMQ Queue,
// TransitionConversationState, and MessagingOutputPort.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SendOAuthReminder,
  type SendOAuthReminderDeps,
  type SendOAuthReminderInput,
} from './SendOAuthReminder';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { Redis } from 'ioredis';
import type { Queue, Job } from 'bullmq';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import type {
  ConversationState,
  ConversationStateExpiryPrecondition,
} from '../../../domain/entities/ConversationState';
import type { SettingsOAuthCleanup } from './SettingsOAuthCleanup';
import { settingsCopies } from '../../copies/settings.copies';

const mockBuildAuthUrl = vi.fn();
const mockGetValidAccessToken = vi.fn();
const mockForceRefreshAccessToken = vi.fn();
const mockConversationFind = vi.fn();
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
      refreshAccessToken: vi.fn(),
    },
    oauthAccessTokenService: {
      getValidAccessToken: mockGetValidAccessToken,
      forceRefreshAccessToken: mockForceRefreshAccessToken,
    },
    conversationRepo: {
      findByUserId: mockConversationFind,
    } as unknown as SendOAuthReminderDeps['conversationRepo'],
    reminderQueue: { add: mockQueueAdd } as unknown as Queue,
    transitionState: {
      execute: mockTransitionExecute,
      precondition: (
        state: ConversationState,
        expiry: ConversationStateExpiryPrecondition = 'any',
      ) => ({
        revision: state.revision,
        currentState: state.currentState,
        expiry,
      }),
    } as unknown as TransitionConversationState,
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
  mockGetValidAccessToken.mockRejectedValue(
    new SpreadsheetError('No token', { code: 'AUTH_ERROR' }),
  );
  mockBuildAuthUrl.mockReturnValue(
    'https://accounts.google.com/o/oauth2/v2/auth?state=fresh-state-789',
  );
  mockQueueAdd.mockResolvedValue({ id: 'job-789' } as Job);
  mockConversationFind.mockResolvedValue({
    userId: 'user-123',
    revision: '0',
    currentState: 'ONBOARDING_DRIVE',
    statePayload: null,
    enteredAt: new Date(),
    expiresAt: null,
    updatedAt: new Date(),
  });
  mockTransitionExecute.mockResolvedValue({
    status: 'updated',
    state: {
      userId: 'user-123',
      revision: '1',
      currentState: 'ONBOARDING_DRIVE',
      statePayload: { provider: 'google', state: 'fresh-state-789' },
      enteredAt: new Date(),
      expiresAt: null,
      updatedAt: new Date(),
    },
  });
});

describe('SendOAuthReminder', () => {
  describe('settings reminder', () => {
    const payload = {
      origin: 'settings',
      flowId: 'flow-1',
      provider: 'google',
      sourceConfigId: 'config-1',
      fileId: 'file-1',
      sheetName: 'Gastos',
      state: 'old-nonce',
      reminderJobId: 'old-job',
    };
    const deadline = new Date(Date.now() + 60_000);

    it('rotates the nonce despite an existing valid token and preserves the deadline', async () => {
      mockGetValidAccessToken.mockResolvedValue({ accessToken: 'old-token' });
      mockConversationFind.mockResolvedValue({
        userId: 'user-123',
        revision: '7',
        currentState: 'SETTINGS_OAUTH',
        statePayload: payload,
        expiresAt: deadline,
      });
      mockTransitionExecute.mockResolvedValue({
        status: 'updated',
        state: { revision: '8' },
      });
      const cleanup = vi.fn();
      const deps = buildMockDeps({
        settingsOAuthCleanup: { execute: cleanup } as unknown as SettingsOAuthCleanup,
      });
      const result = await new SendOAuthReminder(deps).execute({
        ...baseInput,
        state: 'old-nonce',
      });
      expect(result.nextState).toBe('SETTINGS_OAUTH');
      expect(mockGetValidAccessToken).not.toHaveBeenCalled();
      expect(mockTransitionExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          targetState: 'SETTINGS_OAUTH',
          expiresAt: deadline,
          payload: { ...payload, state: 'fresh-state-789', reminderJobId: 'job-789' },
          expected: { revision: '7', currentState: 'SETTINGS_OAUTH', expiry: 'unexpired' },
        }),
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
          revision: '8',
          origin: 'settings',
          flowId: 'flow-1',
        }),
      );
      expect(cleanup).toHaveBeenCalledWith(payload);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        settingsCopies.reminder(
          'https://accounts.google.com/o/oauth2/v2/auth?state=fresh-state-789',
        ),
      );
    });

    it('does not rotate a stale or expired settings flow', async () => {
      mockConversationFind.mockResolvedValue({
        userId: 'user-123',
        revision: '7',
        currentState: 'SETTINGS_OAUTH',
        statePayload: payload,
        expiresAt: new Date(Date.now() - 1000),
      });
      await new SendOAuthReminder(buildMockDeps()).execute({ ...baseInput, state: 'old-nonce' });
      expect(mockQueueAdd).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('does not rotate a superseded nonce even before expiry', async () => {
      mockConversationFind.mockResolvedValue({
        userId: 'user-123',
        revision: '8',
        currentState: 'SETTINGS_OAUTH',
        statePayload: { ...payload, state: 'newer-nonce' },
        expiresAt: deadline,
      });
      await new SendOAuthReminder(buildMockDeps()).execute({ ...baseInput, state: 'old-nonce' });
      expect(mockTransitionExecute).not.toHaveBeenCalled();
      expect(mockQueueAdd).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
  describe('reminder sent with fresh state', () => {
    it('generates new state, stores in Redis, schedules job, updates FSM payload, and sends message', async () => {
      const deps = buildMockDeps();
      const useCase = new SendOAuthReminder(deps);
      const result = await useCase.execute(baseInput);

      expect(mockGetValidAccessToken).toHaveBeenCalledWith({
        userId: 'user-123',
        provider: 'google',
      });
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
          revision: '1',
        }),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_DRIVE',
        payload: { provider: 'google', state: 'fresh-state-789' },
        expected: { revision: '0', currentState: 'ONBOARDING_DRIVE', expiry: 'any' },
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
      mockGetValidAccessToken.mockResolvedValue({
        accessToken: 'active-access-token',
        expiresAt: new Date(Date.now() + 60_000),
        refreshed: false,
      });

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

  describe('stale reminder', () => {
    it('skips when user is no longer in ONBOARDING_DRIVE', async () => {
      mockConversationFind.mockResolvedValue({
        userId: 'user-123',
        currentState: 'IDLE',
        statePayload: null,
        enteredAt: new Date(),
        expiresAt: null,
        updatedAt: new Date(),
      });

      const deps = buildMockDeps();
      const useCase = new SendOAuthReminder(deps);
      const result = await useCase.execute(baseInput);

      expect(result.message).toBe('');
      expect(result.nextState).toBe('IDLE');
      expect(mockBuildAuthUrl).not.toHaveBeenCalled();
      expect(mockQueueAdd).not.toHaveBeenCalled();
      expect(mockRedisSetex).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('fallback job id when BullMQ returns undefined id', () => {
    it('uses a fallback job id when BullMQ job id is missing', async () => {
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
