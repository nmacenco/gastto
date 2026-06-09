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
import type { IOAuthTokenRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { OAuthDeniedError } from '../../../domain/errors/OAuthDeniedError';
import { OAuthNetworkError } from '../../../domain/errors/OAuthNetworkError';
import { OAuthStateMismatchError } from '../../../domain/errors/OAuthStateMismatchError';

const mockRedisGet = vi.fn();
const mockRedisDel = vi.fn();
const mockExchangeCode = vi.fn();
const mockTokenUpsert = vi.fn();
const mockQueueRemove = vi.fn();
const mockTransitionExecute = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockEncrypt = vi.fn();

function buildMockDeps(overrides: Partial<HandleOAuthCallbackDeps> = {}): HandleOAuthCallbackDeps {
  return {
    redis: { get: mockRedisGet, del: mockRedisDel } as unknown as Redis,
    oauthService: {
      buildAuthUrl: vi.fn(),
      exchangeCode: mockExchangeCode,
    },
    tokenRepository: { upsert: mockTokenUpsert } as unknown as IOAuthTokenRepository,
    reminderQueue: { remove: mockQueueRemove } as unknown as Queue,
    transitionState: { execute: mockTransitionExecute } as unknown as TransitionConversationState,
    messagingPort: { sendMessage: mockSendMessage },
    tokenEncryption: { encrypt: mockEncrypt, decrypt: vi.fn() },
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
});

beforeEach(() => {
  vi.clearAllMocks();
  mockEncrypt.mockReturnValue({ ciphertext: Buffer.from('enc'), iv: Buffer.from('iv') });
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
        accessTokenEnc: Buffer.from('enc'),
        refreshTokenEnc: Buffer.from('enc'),
        iv: Buffer.from('iv'),
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
      expect(result.message).toBe(onboardingCopies.connectionFailed(true));
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

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const deps = buildMockDeps();
      const useCase = new HandleOAuthCallback(deps);
      const result = await useCase.execute(baseInput);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'HandleOAuthCallback',
          code: 'REMINDER_CANCEL_FAILED',
        }),
      );
      expect(result.success).toBe(true);
      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(mockSendMessage).toHaveBeenCalled();
      expect(mockTransitionExecute).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
