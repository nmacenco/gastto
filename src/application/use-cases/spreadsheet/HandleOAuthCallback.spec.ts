// LAYER: Application / Tests
// Unit tests for HandleOAuthCallback use case.
// Mocks all ports to verify state validation, token exchange, persistence,
// reminder cancellation, messaging, and FSM transition.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HandleOAuthCallback,
  type HandleOAuthCallbackDeps,
  type HandleOAuthCallbackInput,
} from './HandleOAuthCallback';
import type {
  IConversationStateRepository,
  IOAuthTokenRepository,
} from '../../../domain/ports/repositories';
import type { Logger } from 'pino';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { HandleSpreadsheetFileSelection } from './HandleSpreadsheetFileSelection';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { OAuthDeniedError } from '../../../domain/errors/OAuthDeniedError';
import { OAuthNetworkError } from '../../../domain/errors/OAuthNetworkError';
import { OAuthStateMismatchError } from '../../../domain/errors/OAuthStateMismatchError';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';

const mockRedisGet = vi.fn();
const mockRedisDel = vi.fn();
const mockExchangeCode = vi.fn();
const mockTokenUpsert = vi.fn();
const mockQueueRemove = vi.fn();
const mockTransitionExecute = vi.fn();
const mockAssertExecutionIsValid = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockEncrypt = vi.fn();
const mockLoggerError = vi.fn();
const mockHandleSpreadsheetFileSelectionExecute = vi.fn().mockResolvedValue({
  nextState: 'ONBOARDING_FILE',
  message: '',
});

function buildMockDeps(overrides: Partial<HandleOAuthCallbackDeps> = {}): HandleOAuthCallbackDeps {
  return {
    redis: { get: mockRedisGet, del: mockRedisDel } as unknown as Redis,
    oauthService: {
      buildAuthUrl: vi.fn(),
      exchangeCode: mockExchangeCode,
      refreshAccessToken: vi.fn(),
    },
    tokenRepository: { upsert: mockTokenUpsert } as unknown as IOAuthTokenRepository,
    reminderQueue: { remove: mockQueueRemove } as unknown as Queue,
    transitionState: {
      execute: mockTransitionExecute,
      runWithState: <T>(_state: never, operation: () => Promise<T>) => operation(),
      assertExecutionIsValid: mockAssertExecutionIsValid,
    } as unknown as TransitionConversationState,
    messagingPort: { sendMessage: mockSendMessage },
    tokenEncryption: { encrypt: mockEncrypt, decrypt: vi.fn() },
    logger: { error: mockLoggerError } as unknown as Logger,
    handleSpreadsheetFileSelection: {
      execute: mockHandleSpreadsheetFileSelectionExecute,
    } as unknown as HandleSpreadsheetFileSelection,
    conversationRepo: {
      findByUserId: vi.fn().mockResolvedValue({
        userId: 'user-123',
        revision: '7',
        currentState: 'ONBOARDING_DRIVE',
        statePayload: { provider: 'google', state: 'test-state-456' },
        enteredAt: new Date(),
        expiresAt: null,
        updatedAt: new Date(),
      }),
    } as unknown as IConversationStateRepository,
    userProcessingLock: {
      acquire: vi.fn().mockResolvedValue('lock-token'),
      renew: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

const baseInput: HandleOAuthCallbackInput = {
  code: 'auth-code-123',
  state: 'test-state-456',
};

const baseRedisPayload = JSON.stringify({
  userId: 'user-123',
  provider: 'google',
  externalId: '987654321',
  channel: 'telegram',
  reminderJobId: 'job-456',
  revision: '7',
});

beforeEach(() => {
  vi.clearAllMocks();
  mockTransitionExecute.mockReset().mockResolvedValue({ status: 'updated' });
  mockAssertExecutionIsValid.mockReset();
  mockSendMessage.mockReset().mockResolvedValue({ status: 'success' });
  mockHandleSpreadsheetFileSelectionExecute.mockReset().mockResolvedValue({
    nextState: 'ONBOARDING_FILE',
    message: '',
  });
  mockEncrypt.mockReset();
  mockEncrypt
    .mockReturnValueOnce({ ciphertext: Buffer.from('access-enc'), iv: Buffer.from('access-iv') })
    .mockReturnValueOnce({ ciphertext: Buffer.from('refresh-enc'), iv: Buffer.from('refresh-iv') });
});

describe('HandleOAuthCallback', () => {
  describe('valid callback', () => {
    it('validates state, exchanges code, persists tokens, cancels reminder, sends success, transitions FSM', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: ['https://www.googleapis.com/auth/drive.file'],
      });
      mockTokenUpsert.mockResolvedValue({ id: 'token-789' });
      mockQueueRemove.mockResolvedValue(1);

      const deps = buildMockDeps();
      const useCase = new HandleOAuthCallback(deps);
      const result = await useCase.execute(baseInput);

      expect(mockRedisGet).toHaveBeenCalledWith('oauth:state:test-state-456');
      expect(mockExchangeCode).toHaveBeenCalledWith('google', 'auth-code-123', 'test-state-456');
      expect(mockEncrypt).toHaveBeenCalledTimes(2);
      expect(mockTokenUpsert).toHaveBeenCalledWith({
        userId: 'user-123',
        provider: 'google',
        accessTokenEnc: Buffer.from('access-enc'),
        refreshTokenEnc: Buffer.from('refresh-enc'),
        iv: Buffer.from('access-iv'),
        refreshIv: Buffer.from('refresh-iv'),
        accessTokenExpiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: ['https://www.googleapis.com/auth/drive.file'],
        grantedAt: expect.any(Date) as Date,
        lastRefreshedAt: null,
        revokedAt: null,
      });
      expect(mockQueueRemove).toHaveBeenCalledWith('job-456');
      expect(mockRedisDel).toHaveBeenCalledWith('oauth:state:test-state-456');
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.googleConnectedSuccess(),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_FILE',
        payload: { provider: 'google' },
        expected: { revision: '7', currentState: 'ONBOARDING_DRIVE', expiry: 'any' },
      });
      expect(mockHandleSpreadsheetFileSelectionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: '',
        externalId: '987654321',
        channel: 'telegram',
        statePayload: { provider: 'google' },
      });

      expect(result.success).toBe(true);
      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(result.message).toBe(onboardingCopies.googleConnectedSuccess());
    });
  });

  describe('invalid or missing state', () => {
    it('returns failure with canRetry when Redis state is missing', async () => {
      mockRedisGet.mockResolvedValue(null);

      const deps = buildMockDeps();
      const useCase = new HandleOAuthCallback(deps);
      const result = await useCase.execute(baseInput);

      expect(result.success).toBe(false);
      expect(result.nextState).toBe('ONBOARDING_DRIVE');
      expect(result.canRetry).toBe(true);
      expect(result.message).toBe(onboardingCopies.oauthConnectionFailed(true));
      expect(mockExchangeCode).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
    });

    it('returns failure with canRetry when Redis payload is invalid JSON', async () => {
      mockRedisGet.mockResolvedValue('not-json');

      const deps = buildMockDeps();
      const useCase = new HandleOAuthCallback(deps);
      const result = await useCase.execute(baseInput);

      expect(result.success).toBe(false);
      expect(result.nextState).toBe('ONBOARDING_DRIVE');
      expect(result.canRetry).toBe(true);
    });
  });

  describe('stale callback races', () => {
    it('does not exchange or persist when the nonce/revision is stale before exchange', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      const conversationRepo = {
        findByUserId: vi.fn().mockResolvedValue({
          userId: 'user-123',
          revision: '8',
          currentState: 'ONBOARDING_DRIVE',
          statePayload: { state: 'new-state' },
        }),
      } as unknown as IConversationStateRepository;

      const result = await new HandleOAuthCallback(buildMockDeps({ conversationRepo })).execute(
        baseInput,
      );

      expect(result.success).toBe(false);
      expect(mockExchangeCode).not.toHaveBeenCalled();
      expect(mockTokenUpsert).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('does not persist or advance when state changes while exchange is pending', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      let completeExchange!: (value: {
        accessToken: string;
        refreshToken: string;
        expiresAt: Date;
        scope: string[];
      }) => void;
      mockExchangeCode.mockImplementation(
        () =>
          new Promise((resolve) => {
            completeExchange = resolve;
          }),
      );
      const matching = {
        userId: 'user-123',
        revision: '7',
        currentState: 'ONBOARDING_DRIVE',
        statePayload: { state: 'test-state-456' },
      };
      const conversationRepo = {
        findByUserId: vi
          .fn()
          .mockResolvedValueOnce(matching)
          .mockResolvedValueOnce({ ...matching, revision: '8', statePayload: { state: 'new-state' } }),
      } as unknown as IConversationStateRepository;
      const execution = new HandleOAuthCallback(buildMockDeps({ conversationRepo })).execute(baseInput);
      await vi.waitFor(() => expect(mockExchangeCode).toHaveBeenCalledOnce());
      completeExchange({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: ['drive.file'],
      });

      await expect(execution).resolves.toMatchObject({ success: false });
      expect(mockTokenUpsert).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('returns controlled failure without token persistence after lease invalidation', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: ['drive.file'],
      });
      mockAssertExecutionIsValid.mockImplementationOnce(() => {
        throw new StaleConversationStateError({ status: 'stale' });
      });

      const result = await new HandleOAuthCallback(buildMockDeps()).execute(baseInput);

      expect(result.success).toBe(false);
      expect(mockTokenUpsert).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('returns controlled failure and sends no success when final state transition is stale', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: ['drive.file'],
      });
      mockTokenUpsert.mockResolvedValue({ id: 'token-789' });
      mockTransitionExecute.mockRejectedValue(
        new StaleConversationStateError({ status: 'stale' }),
      );

      const result = await new HandleOAuthCallback(buildMockDeps()).execute(baseInput);

      expect(result.success).toBe(false);
      expect(mockTokenUpsert).toHaveBeenCalledOnce();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockHandleSpreadsheetFileSelectionExecute).not.toHaveBeenCalled();
    });
  });

  describe('user denies authorization', () => {
    it('returns failure with canRetry when exchangeCode throws OAuthDeniedError', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockRejectedValue(new OAuthDeniedError());

      const deps = buildMockDeps();
      const useCase = new HandleOAuthCallback(deps);
      const result = await useCase.execute(baseInput);

      expect(result.success).toBe(false);
      expect(result.nextState).toBe('ONBOARDING_DRIVE');
      expect(result.canRetry).toBe(true);
      expect(mockTokenUpsert).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
    });
  });

  describe('network failure during token exchange', () => {
    it('returns failure with canRetry when exchangeCode throws OAuthNetworkError', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockRejectedValue(new OAuthNetworkError());

      const deps = buildMockDeps();
      const useCase = new HandleOAuthCallback(deps);
      const result = await useCase.execute(baseInput);

      expect(result.success).toBe(false);
      expect(result.nextState).toBe('ONBOARDING_DRIVE');
      expect(result.canRetry).toBe(true);
      expect(mockTokenUpsert).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
    });
  });

  describe('OAuth state mismatch during token exchange', () => {
    it('returns failure with canRetry when exchangeCode throws OAuthStateMismatchError', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockRejectedValue(new OAuthStateMismatchError());

      const deps = buildMockDeps();
      const useCase = new HandleOAuthCallback(deps);
      const result = await useCase.execute(baseInput);

      expect(result.success).toBe(false);
      expect(result.nextState).toBe('ONBOARDING_DRIVE');
      expect(result.canRetry).toBe(true);
      expect(mockTokenUpsert).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
    });
  });

  describe('token persistence failure', () => {
    it('returns failure with canRetry and does not send message', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: ['drive.file'],
      });
      mockTokenUpsert.mockRejectedValue(new Error('DB error'));

      const deps = buildMockDeps();
      const useCase = new HandleOAuthCallback(deps);
      const result = await useCase.execute(baseInput);

      expect(result.success).toBe(false);
      expect(result.nextState).toBe('ONBOARDING_DRIVE');
      expect(result.canRetry).toBe(true);
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
    });
  });

  describe('reminder job cancellation failure', () => {
    it('logs the error but still returns success', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: ['drive.file'],
      });
      mockTokenUpsert.mockResolvedValue({ id: 'token-789' });
      mockQueueRemove.mockRejectedValue(new Error('Job not found'));

      const deps = buildMockDeps();
      const useCase = new HandleOAuthCallback(deps);
      const result = await useCase.execute(baseInput);

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'HandleOAuthCallback',
          code: 'REMINDER_CANCEL_FAILED',
        }),
      );
      expect(result.success).toBe(true);
      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(mockSendMessage).toHaveBeenCalled();
      expect(mockTransitionExecute).toHaveBeenCalled();
    });
  });

  describe('post-callback file selection failure', () => {
    it('logs the error and still returns success so the HTTP response is not blocked', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: ['drive.file'],
      });
      mockTokenUpsert.mockResolvedValue({ id: 'token-789' });
      mockQueueRemove.mockResolvedValue(1);
      mockHandleSpreadsheetFileSelectionExecute.mockRejectedValue(new Error('Discovery timeout'));

      const deps = buildMockDeps();
      const useCase = new HandleOAuthCallback(deps);
      const result = await useCase.execute(baseInput);

      expect(mockHandleSpreadsheetFileSelectionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: '',
        externalId: '987654321',
        channel: 'telegram',
        statePayload: { provider: 'google' },
      });
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'HandleOAuthCallback',
          code: 'POST_CALLBACK_FILE_SELECTION_FAILED',
        }),
      );
      expect(result.success).toBe(true);
      expect(result.nextState).toBe('ONBOARDING_FILE');
    });
  });
});
