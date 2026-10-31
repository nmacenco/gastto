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
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
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
import type { SettingsCredentialCommit } from '../../ports/SettingsCredentialCommit';
import type { ValidateSpreadsheetAccessPortFactory } from '../../../domain/ports/spreadsheetAccess';
import type { SettingsOAuthCleanup } from './SettingsOAuthCleanup';
import { settingsCopies } from '../../copies/settings.copies';
import type { ConversationState } from '../../../domain/entities/ConversationState';

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
const mockFindSpreadsheetConfig = vi.fn();
const mockFindColumnMappings = vi.fn();

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
    spreadsheetConfigRepository: {
      findByUserId: mockFindSpreadsheetConfig,
    } as unknown as ISpreadsheetConfigRepository,
    columnMappingRepository: {
      findBySpreadsheetId: mockFindColumnMappings,
    } as unknown as IColumnMappingRepository,
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
  mockFindSpreadsheetConfig.mockReset().mockResolvedValue(null);
  mockFindColumnMappings.mockReset().mockResolvedValue([]);
  mockEncrypt.mockReset();
  mockEncrypt
    .mockReturnValueOnce({ ciphertext: Buffer.from('access-enc'), iv: Buffer.from('access-iv') })
    .mockReturnValueOnce({ ciphertext: Buffer.from('refresh-enc'), iv: Buffer.from('refresh-iv') });
});

describe('HandleOAuthCallback', () => {
  describe('settings reauthorization', () => {
    const nonce = 'settings-nonce';
    const metadata = JSON.stringify({
      userId: 'user-123',
      provider: 'google',
      externalId: '987654321',
      channel: 'telegram',
      reminderJobId: 'job-1',
      revision: '7',
      origin: 'settings',
      flowId: 'flow-1',
    });
    const observed: ConversationState = {
      userId: 'user-123',
      revision: '7',
      currentState: 'SETTINGS_OAUTH',
      statePayload: {
        origin: 'settings',
        flowId: 'flow-1',
        provider: 'google',
        sourceConfigId: 'config-1',
        fileId: 'file-1',
        sheetName: 'Gastos',
        state: nonce,
        reminderJobId: 'job-1',
      },
      enteredAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    };

    function settingsDeps(state: ConversationState = observed) {
      const commit = vi.fn().mockResolvedValue('committed');
      const validate = vi.fn().mockResolvedValue({ kind: 'success', preview: {} });
      const cleanup = vi.fn().mockResolvedValue(undefined);
      mockRedisGet.mockResolvedValue(metadata);
      mockFindSpreadsheetConfig.mockResolvedValue({
        id: 'config-1',
        provider: 'google',
        fileId: 'file-1',
        sheetName: 'Gastos',
      });
      mockExchangeCode.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: new Date(Date.now() + 3_600_000),
        scope: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const deps = buildMockDeps({
        conversationRepo: {
          findByUserId: vi.fn().mockResolvedValue(state),
        } as unknown as IConversationStateRepository,
        transitionState: {
          execute: mockTransitionExecute,
          runWithState: <T>(_state: ConversationState, operation: () => Promise<T>) => operation(),
          assertExecutionIsValid: mockAssertExecutionIsValid,
          precondition: (current: ConversationState, expiry: 'unexpired' | 'expired' | 'any') => ({
            revision: current.revision,
            currentState: current.currentState,
            expiry,
          }),
        } as unknown as TransitionConversationState,
        settingsCredentialCommit: { execute: commit } as unknown as SettingsCredentialCommit,
        settingsAccessFactory: {
          create: vi.fn().mockReturnValue({ validateSpreadsheetAccess: validate }),
        } as unknown as ValidateSpreadsheetAccessPortFactory,
        settingsOAuthCleanup: { execute: cleanup } as unknown as SettingsOAuthCleanup,
      });
      return { deps, commit, validate, cleanup };
    }

    it('validates the candidate before an atomic credential and state commit', async () => {
      const { deps, commit, validate, cleanup } = settingsDeps();
      const result = await new HandleOAuthCallback(deps).execute({
        code: 'new-code',
        state: nonce,
      });
      expect(result).toMatchObject({ success: true, nextState: 'IDLE' });
      expect(validate).toHaveBeenCalledWith('file-1', 'Gastos');
      expect(commit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          flowId: 'flow-1',
          sourceConfigId: 'config-1',
          expected: { revision: '7', currentState: 'SETTINGS_OAUTH', expiry: 'unexpired' },
        }),
      );
      expect(mockTokenUpsert).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(mockSendMessage).toHaveBeenCalledWith('987654321', settingsCopies.reauthorized());
    });

    it('exits on provider denial without exchanging or replacing a token', async () => {
      const { deps, commit, cleanup } = settingsDeps();
      const result = await new HandleOAuthCallback(deps).execute({
        error: 'access_denied',
        state: nonce,
      });
      expect(result).toMatchObject({ success: false, nextState: 'IDLE' });
      expect(mockExchangeCode).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      expect(mockTransitionExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          targetState: 'IDLE',
          expected: { revision: '7', currentState: 'SETTINGS_OAUTH', expiry: 'unexpired' },
        }),
      );
      expect(cleanup).toHaveBeenCalledOnce();
    });

    it('rejects a stale nonce without exchange or cleanup', async () => {
      const { deps, commit, cleanup } = settingsDeps({ ...observed, revision: '8' });
      const result = await new HandleOAuthCallback(deps).execute({
        code: 'new-code',
        state: nonce,
      });
      expect(result.success).toBe(false);
      expect(mockExchangeCode).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
    });

    it('rejects a flow replaced while candidate access validation was pending', async () => {
      const { deps, commit, cleanup } = settingsDeps();
      const replacement = {
        ...observed,
        revision: '8',
        statePayload: { ...observed.statePayload, state: 'newer-nonce' },
      };
      const findByUserId = vi
        .fn()
        .mockResolvedValueOnce(observed)
        .mockResolvedValueOnce(replacement);
      deps.conversationRepo = { findByUserId } as unknown as IConversationStateRepository;
      const result = await new HandleOAuthCallback(deps).execute({
        code: 'new-code',
        state: nonce,
      });
      expect(result.success).toBe(false);
      expect(mockExchangeCode).toHaveBeenCalledOnce();
      expect(commit).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalledWith('987654321', settingsCopies.reauthorized());
    });

    it('expires an owned flow and preserves the old token', async () => {
      const { deps, commit } = settingsDeps({
        ...observed,
        expiresAt: new Date(Date.now() - 1000),
      });
      const result = await new HandleOAuthCallback(deps).execute({
        code: 'new-code',
        state: nonce,
      });
      expect(result).toMatchObject({ success: false, nextState: 'IDLE' });
      expect(mockTransitionExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          targetState: 'IDLE',
          expected: { revision: '7', currentState: 'SETTINGS_OAUTH', expiry: 'expired' },
        }),
      );
      expect(commit).not.toHaveBeenCalled();
    });

    it.each(['read-only', 'access-error'])(
      'rejects %s access to the existing destination',
      async (kind) => {
        const { deps, commit, validate } = settingsDeps();
        validate.mockResolvedValue({ kind });
        const result = await new HandleOAuthCallback(deps).execute({
          code: 'new-code',
          state: nonce,
        });
        expect(result).toMatchObject({ success: false, nextState: 'IDLE' });
        expect(commit).not.toHaveBeenCalled();
        expect(mockSendMessage).toHaveBeenCalledWith('987654321', settingsCopies.accessFailed());
      },
    );

    it('keeps the old credential and flow when persistence fails', async () => {
      const { deps, commit, cleanup } = settingsDeps();
      commit.mockRejectedValue(new Error('database unavailable'));
      const result = await new HandleOAuthCallback(deps).execute({
        code: 'new-code',
        state: nonce,
      });
      expect(result).toMatchObject({ success: false, nextState: 'SETTINGS_OAUTH' });
      expect(cleanup).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalledWith('987654321', settingsCopies.reauthorized());
    });
  });
  describe('valid callback', () => {
    it('restores a completed spreadsheet configuration after reauthorization', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: [],
      });
      mockTokenUpsert.mockResolvedValue({ id: 'token-789' });
      mockQueueRemove.mockResolvedValue(1);
      mockFindSpreadsheetConfig.mockResolvedValue({
        id: 'config-1',
        provider: 'google',
        fileId: 'file-1',
        sheetName: 'Gastos',
      });
      mockFindColumnMappings.mockResolvedValue([{ confirmedAt: new Date() }]);
      const conversationRepo = {
        findByUserId: vi.fn().mockResolvedValue({
          userId: 'user-123',
          revision: '7',
          currentState: 'ONBOARDING_DRIVE',
          statePayload: {
            provider: 'google',
            state: 'test-state-456',
            reauthorizationOnly: true,
          },
        }),
      } as unknown as IConversationStateRepository;

      const result = await new HandleOAuthCallback(buildMockDeps({ conversationRepo })).execute(
        baseInput,
      );

      expect(result).toMatchObject({ success: true, nextState: 'IDLE' });
      expect(mockTransitionExecute).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-123', targetState: 'IDLE', payload: null }),
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.googleReconnectedSuccess(),
      );
      expect(mockHandleSpreadsheetFileSelectionExecute).not.toHaveBeenCalled();
    });

    it('continues file selection when the previous column mapping is incomplete', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: [],
      });
      mockFindSpreadsheetConfig.mockResolvedValue({
        id: 'config-1',
        provider: 'google',
        fileId: 'file-1',
        sheetName: 'Gastos',
      });
      const conversationRepo = {
        findByUserId: vi.fn().mockResolvedValue({
          userId: 'user-123',
          revision: '7',
          currentState: 'ONBOARDING_DRIVE',
          statePayload: {
            provider: 'google',
            state: 'test-state-456',
            reauthorizationOnly: true,
          },
        }),
      } as unknown as IConversationStateRepository;

      const result = await new HandleOAuthCallback(buildMockDeps({ conversationRepo })).execute(
        baseInput,
      );

      expect(result).toMatchObject({ success: true, nextState: 'ONBOARDING_FILE' });
      expect(mockHandleSpreadsheetFileSelectionExecute).toHaveBeenCalledOnce();
    });

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
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'OAUTH_STATE_STALE', userId: 'user-123' }),
      );
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
          .mockResolvedValueOnce({
            ...matching,
            revision: '8',
            statePayload: { state: 'new-state' },
          }),
      } as unknown as IConversationStateRepository;
      const execution = new HandleOAuthCallback(buildMockDeps({ conversationRepo })).execute(
        baseInput,
      );
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
      mockTransitionExecute.mockRejectedValue(new StaleConversationStateError({ status: 'stale' }));

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

    it('logs a safe provider code when Google rejects the client credentials', async () => {
      mockRedisGet.mockResolvedValue(baseRedisPayload);
      mockExchangeCode.mockRejectedValue(
        new OAuthNetworkError('Google OAuth error (invalid_client): HTTP 401'),
      );

      const result = await new HandleOAuthCallback(buildMockDeps()).execute(baseInput);

      expect(result.success).toBe(false);
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'OAUTH_EXCHANGE_REJECTED',
          providerErrorCode: 'invalid_client',
          errorType: 'OAuthNetworkError',
        }),
      );
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
