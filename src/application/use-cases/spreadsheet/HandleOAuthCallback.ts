// LAYER: Application
// Use case: handle OAuth callback after user authorizes the cloud provider.
// Validates CSRF state, exchanges code for tokens, persists encrypted tokens,
// cancels reminder job, and transitions FSM to ONBOARDING_FILE.

import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { OAuthServicePort } from '../../../domain/ports/oauth';
import type {
  IConversationStateRepository,
  IOAuthTokenRepository,
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
} from '../../../domain/ports/repositories';
import type { TokenEncryptionPort } from '../../../domain/ports/tokenEncryption';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import type { HandleSpreadsheetFileSelection } from './HandleSpreadsheetFileSelection';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { OAuthDeniedError } from '../../../domain/errors/OAuthDeniedError';
import { OAuthNetworkError } from '../../../domain/errors/OAuthNetworkError';
import { OAuthStateMismatchError } from '../../../domain/errors/OAuthStateMismatchError';
import type { IUserProcessingLock } from '../../ports/UserProcessingLock';
import { startUserProcessingLeaseRenewal } from '../../services/UserProcessingLease';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';
import type { ValidateSpreadsheetAccessPortFactory } from '../../../domain/ports/spreadsheetAccess';
import type { SettingsCredentialCommit } from '../../ports/SettingsCredentialCommit';
import { parseSettingsOAuthPayload, type SettingsOAuthPayload } from './SettingsOAuthFlow';
import type { SettingsOAuthCleanup } from './SettingsOAuthCleanup';
import { settingsCopies } from '../../copies/settings.copies';
import type { ConversationState } from '../../../domain/entities/ConversationState';

export type HandleOAuthCallbackInput =
  | { code: string; state: string; error?: never }
  | { error: string; state: string; code?: never };

export interface HandleOAuthCallbackOutput {
  success: boolean;
  nextState: FsmState;
  message: string;
  errorMessage?: string;
  canRetry?: boolean;
}

interface OAuthStatePayload {
  userId: string;
  provider: SpreadsheetProvider;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  reminderJobId: string;
  revision: string;
  origin?: 'settings';
  flowId?: string;
}

export interface HandleOAuthCallbackDeps {
  redis: Redis;
  oauthService: OAuthServicePort;
  tokenRepository: IOAuthTokenRepository;
  reminderQueue: Queue;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  tokenEncryption: TokenEncryptionPort;
  logger: Logger;
  handleSpreadsheetFileSelection: HandleSpreadsheetFileSelection;
  conversationRepo: IConversationStateRepository;
  userProcessingLock: IUserProcessingLock;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  columnMappingRepository: IColumnMappingRepository;
  settingsCredentialCommit?: SettingsCredentialCommit;
  settingsAccessFactory?: ValidateSpreadsheetAccessPortFactory;
  settingsOAuthCleanup?: SettingsOAuthCleanup;
}

export class HandleOAuthCallback {
  constructor(private readonly deps: HandleOAuthCallbackDeps) {}

  async execute(input: HandleOAuthCallbackInput): Promise<HandleOAuthCallbackOutput> {
    const { state } = input;
    const redisKey = `oauth:state:${state}`;

    const raw = await this.deps.redis.get(redisKey);
    if (!raw) {
      this.deps.logger.error({
        endpoint: 'HandleOAuthCallback',
        code: 'OAUTH_STATE_MISSING',
        hasState: false,
      });
      return {
        success: false,
        nextState: 'ONBOARDING_DRIVE',
        message: onboardingCopies.oauthConnectionFailed(true),
        canRetry: true,
      };
    }

    let metadata: OAuthStatePayload;
    try {
      metadata = JSON.parse(raw) as OAuthStatePayload;
      if (
        typeof metadata.userId !== 'string' ||
        !metadata.userId ||
        typeof metadata.revision !== 'string' ||
        !metadata.revision ||
        typeof metadata.externalId !== 'string' ||
        !metadata.externalId ||
        !['telegram', 'whatsapp'].includes(metadata.channel) ||
        !['google', 'microsoft'].includes(metadata.provider) ||
        typeof metadata.reminderJobId !== 'string' ||
        (metadata.origin !== undefined && metadata.origin !== 'settings') ||
        (metadata.origin === 'settings' &&
          (typeof metadata.flowId !== 'string' || !metadata.flowId))
      )
        throw new Error('Invalid OAuth state metadata');
    } catch (err) {
      this.deps.logger.error({
        endpoint: 'HandleOAuthCallback',
        code: 'OAUTH_STATE_INVALID',
        hasState: true,
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
      });
      return {
        success: false,
        nextState: 'ONBOARDING_DRIVE',
        message: onboardingCopies.oauthConnectionFailed(true),
        canRetry: true,
      };
    }

    const lockToken = await this.deps.userProcessingLock.acquire(metadata.userId, 180_000);
    if (!lockToken) {
      return {
        success: false,
        nextState: 'ONBOARDING_DRIVE',
        message: onboardingCopies.oauthConnectionFailed(true),
        canRetry: true,
      };
    }
    const stopRenewal = startUserProcessingLeaseRenewal({
      userId: metadata.userId,
      token: lockToken,
      lock: this.deps.userProcessingLock,
      transitionState: this.deps.transitionState,
      logger: this.deps.logger,
      endpoint: 'HandleOAuthCallback',
    });

    try {
      const observed = await this.deps.conversationRepo.findByUserId(metadata.userId);
      if (
        metadata.origin === 'settings'
          ? !this.matchesSettingsNonce(observed, state, metadata)
          : !this.matchesPersistedNonce(observed, state, metadata.revision)
      ) {
        return {
          success: false,
          nextState: observed?.currentState ?? 'IDLE',
          message: onboardingCopies.oauthConnectionFailed(true),
          canRetry: true,
        };
      }

      if (metadata.origin === 'settings') {
        return this.deps.transitionState.runWithState(observed!, () =>
          this.handleSettingsCallback(input, metadata, observed!, state),
        );
      }

      if ('error' in input) {
        return {
          success: false,
          nextState: 'ONBOARDING_DRIVE',
          message: onboardingCopies.oauthConnectionFailed(true),
          canRetry: true,
        };
      }
      const code = input.code;
      return await this.deps.transitionState.runWithState(observed!, async () => {
        const reauthorizationOnly = observed?.statePayload?.reauthorizationOnly === true;
        const config = reauthorizationOnly
          ? await this.deps.spreadsheetConfigRepository.findByUserId(metadata.userId)
          : null;
        const confirmedMappings =
          config && config.provider === metadata.provider
            ? await this.deps.columnMappingRepository.findBySpreadsheetId(config.id)
            : [];
        const reuseConfiguration =
          reauthorizationOnly &&
          config !== null &&
          config.provider === metadata.provider &&
          config.fileId.length > 0 &&
          config.sheetName.length > 0 &&
          confirmedMappings.length > 0 &&
          confirmedMappings.every((mapping) => mapping.confirmedAt !== null);

        try {
          const tokenResponse = await this.deps.oauthService.exchangeCode(
            metadata.provider,
            code,
            state,
          );

          const accessEnc = this.deps.tokenEncryption.encrypt(tokenResponse.accessToken);
          const refreshEnc = this.deps.tokenEncryption.encrypt(tokenResponse.refreshToken);

          const beforePersistence = await this.deps.conversationRepo.findByUserId(metadata.userId);
          if (!this.matchesPersistedNonce(beforePersistence, state, metadata.revision)) {
            return {
              success: false,
              nextState: beforePersistence?.currentState ?? 'IDLE',
              message: onboardingCopies.oauthConnectionFailed(true),
              canRetry: true,
            };
          }

          this.deps.transitionState.assertExecutionIsValid(metadata.userId);

          await this.deps.tokenRepository.upsert({
            userId: metadata.userId,
            provider: metadata.provider,
            accessTokenEnc: accessEnc.ciphertext,
            refreshTokenEnc: refreshEnc.ciphertext,
            iv: accessEnc.iv,
            refreshIv: refreshEnc.iv,
            accessTokenExpiresAt: tokenResponse.expiresAt,
            scope: tokenResponse.scope,
            grantedAt: new Date(),
            lastRefreshedAt: null,
            revokedAt: null,
          });
        } catch (err) {
          if (
            err instanceof OAuthDeniedError ||
            err instanceof OAuthNetworkError ||
            err instanceof OAuthStateMismatchError
          ) {
            this.deps.logger.error({
              endpoint: 'HandleOAuthCallback',
              code: 'OAUTH_EXCHANGE_REJECTED',
              provider: metadata.provider,
              errorType: err instanceof Error ? err.constructor.name : 'unknown',
            });
            return {
              success: false,
              nextState: 'ONBOARDING_DRIVE',
              message: onboardingCopies.oauthConnectionFailed(true),
              canRetry: true,
            };
          }

          this.deps.logger.error({
            endpoint: 'HandleOAuthCallback',
            code: 'OAUTH_EXCHANGE_UNEXPECTED_ERROR',
            provider: metadata.provider,
            errorType: err instanceof Error ? err.constructor.name : 'unknown',
          });
          return {
            success: false,
            nextState: 'ONBOARDING_DRIVE',
            message: onboardingCopies.oauthConnectionFailed(true),
            canRetry: true,
          };
        }

        try {
          await this.deps.reminderQueue.remove(metadata.reminderJobId);
        } catch (removeErr) {
          this.deps.logger.error({
            endpoint: 'HandleOAuthCallback',
            code: 'REMINDER_CANCEL_FAILED',
            jobId: metadata.reminderJobId,
            error: String(removeErr),
          });
        }

        try {
          await this.deps.redis.del(redisKey);
        } catch {
          // non-critical
        }

        if (reuseConfiguration) {
          const message = onboardingCopies.googleReconnectedSuccess();
          await this.deps.transitionState.execute({
            userId: metadata.userId,
            targetState: 'IDLE',
            payload: null,
            expected: {
              revision: metadata.revision,
              currentState: 'ONBOARDING_DRIVE',
              expiry: 'any',
            },
          });
          await this.deps.messagingPort.sendMessage(metadata.externalId, message);
          return { success: true, nextState: 'IDLE', message };
        }

        const successMessage =
          metadata.provider === 'google'
            ? onboardingCopies.googleConnectedSuccess()
            : onboardingCopies.onedriveConnectedSuccess();

        await this.deps.transitionState.execute({
          userId: metadata.userId,
          targetState: 'ONBOARDING_FILE',
          payload: { provider: metadata.provider },
          expected: {
            revision: metadata.revision,
            currentState: 'ONBOARDING_DRIVE',
            expiry: 'any',
          },
        });

        await this.deps.messagingPort.sendMessage(metadata.externalId, successMessage);

        try {
          await this.deps.handleSpreadsheetFileSelection.execute({
            userId: metadata.userId,
            rawMessage: '',
            externalId: metadata.externalId,
            channel: metadata.channel,
            statePayload: { provider: metadata.provider },
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.deps.logger.error({
            endpoint: 'HandleOAuthCallback',
            code: 'POST_CALLBACK_FILE_SELECTION_FAILED',
            userId: metadata.userId,
            errorType: err instanceof Error ? err.constructor.name : 'unknown',
            error: errorMessage,
          });
        }

        return {
          success: true,
          nextState: 'ONBOARDING_FILE',
          message: successMessage,
        };
      });
    } catch (error) {
      if (!(error instanceof StaleConversationStateError)) throw error;
      this.deps.logger.error({
        msg: 'OAuth callback lost conversation-state ownership',
        endpoint: 'HandleOAuthCallback',
        code: 'STALE_CONVERSATION_STATE',
        userId: metadata.userId,
      });
      return {
        success: false,
        nextState: metadata.origin === 'settings' ? 'SETTINGS_OAUTH' : 'ONBOARDING_DRIVE',
        message:
          metadata.origin === 'settings'
            ? settingsCopies.retry()
            : onboardingCopies.oauthConnectionFailed(true),
        canRetry: true,
      };
    } finally {
      stopRenewal();
      try {
        await this.deps.userProcessingLock.release(metadata.userId, lockToken);
      } catch (releaseError) {
        this.deps.logger.error({
          msg: 'Failed to release per-user processing lock',
          endpoint: 'HandleOAuthCallback',
          code: 'LOCK_RELEASE_FAILED',
          userId: metadata.userId,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
      }
    }
  }

  private async handleSettingsCallback(
    input: HandleOAuthCallbackInput,
    metadata: OAuthStatePayload,
    observed: ConversationState,
    nonce: string,
  ): Promise<HandleOAuthCallbackOutput> {
    const payload = parseSettingsOAuthPayload(observed);
    if (
      !payload ||
      observed.revision !== metadata.revision ||
      payload.state !== nonce ||
      payload.flowId !== metadata.flowId ||
      metadata.provider !== 'google'
    ) {
      return {
        success: false,
        nextState: observed.currentState,
        message: settingsCopies.retry(),
        canRetry: true,
      };
    }
    if (observed.expiresAt === null || observed.expiresAt.getTime() <= Date.now()) {
      await this.endSettingsFlow(observed, payload, 'expired');
      return { success: false, nextState: 'IDLE', message: settingsCopies.expired() };
    }
    const config = await this.deps.spreadsheetConfigRepository.findByUserId(metadata.userId);
    if (
      !config ||
      config.id !== payload.sourceConfigId ||
      config.provider !== 'google' ||
      config.fileId !== payload.fileId ||
      config.sheetName !== payload.sheetName
    ) {
      return {
        success: false,
        nextState: observed.currentState,
        message: settingsCopies.retry(),
        canRetry: true,
      };
    }
    if ('error' in input) {
      await this.endSettingsFlow(observed, payload, 'unexpired');
      await this.sendSettingsMessage(metadata.externalId, settingsCopies.denied());
      return { success: false, nextState: 'IDLE', message: settingsCopies.denied() };
    }

    if (!this.deps.settingsAccessFactory || !this.deps.settingsCredentialCommit) {
      throw new Error('Settings OAuth dependencies are missing');
    }
    let candidate: Awaited<ReturnType<OAuthServicePort['exchangeCode']>>;
    try {
      candidate = await this.deps.oauthService.exchangeCode('google', input.code, nonce);
    } catch (error) {
      this.deps.logger.error({
        msg: 'Settings OAuth token exchange failed',
        endpoint: 'HandleOAuthCallback',
        code: 'SETTINGS_OAUTH_EXCHANGE_FAILED',
        userId: metadata.userId,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
      });
      return {
        success: false,
        nextState: 'SETTINGS_OAUTH',
        message: settingsCopies.retry(),
        canRetry: true,
      };
    }

    let validAccess = false;
    try {
      if (candidate.scope.includes('https://www.googleapis.com/auth/spreadsheets')) {
        const result = await this.deps.settingsAccessFactory
          .create('google', candidate.accessToken)
          .validateSpreadsheetAccess(payload.fileId, payload.sheetName);
        validAccess = result.kind === 'success';
      }
    } catch (error) {
      this.deps.logger.error({
        msg: 'Settings OAuth access validation failed',
        endpoint: 'HandleOAuthCallback',
        code: 'SETTINGS_ACCESS_VALIDATION_FAILED',
        userId: metadata.userId,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
      });
    }
    if (!validAccess) {
      await this.endSettingsFlow(observed, payload, 'unexpired');
      await this.sendSettingsMessage(metadata.externalId, settingsCopies.accessFailed());
      return { success: false, nextState: 'IDLE', message: settingsCopies.accessFailed() };
    }

    const beforeCommit = await this.deps.conversationRepo.findByUserId(metadata.userId);
    const beforePayload = parseSettingsOAuthPayload(beforeCommit);
    if (
      !beforeCommit ||
      !beforePayload ||
      beforeCommit.revision !== metadata.revision ||
      beforePayload.state !== nonce ||
      beforePayload.flowId !== payload.flowId ||
      !beforeCommit.expiresAt ||
      beforeCommit.expiresAt.getTime() <= Date.now()
    ) {
      return {
        success: false,
        nextState: beforeCommit?.currentState ?? 'IDLE',
        message: settingsCopies.retry(),
        canRetry: true,
      };
    }
    this.deps.transitionState.assertExecutionIsValid(metadata.userId);
    const accessEnc = this.deps.tokenEncryption.encrypt(candidate.accessToken);
    const refreshEnc = this.deps.tokenEncryption.encrypt(candidate.refreshToken);
    let committed: 'committed' | 'stale';
    try {
      committed = await this.deps.settingsCredentialCommit.execute({
        userId: metadata.userId,
        expected: this.deps.transitionState.precondition(beforeCommit, 'unexpired'),
        flowId: payload.flowId,
        nonce,
        sourceConfigId: payload.sourceConfigId,
        fileId: payload.fileId,
        sheetName: payload.sheetName,
        credential: {
          userId: metadata.userId,
          provider: 'google',
          accessTokenEnc: accessEnc.ciphertext,
          refreshTokenEnc: refreshEnc.ciphertext,
          iv: accessEnc.iv,
          refreshIv: refreshEnc.iv,
          accessTokenExpiresAt: candidate.expiresAt,
          scope: candidate.scope,
          grantedAt: new Date(),
          lastRefreshedAt: null,
          revokedAt: null,
        },
      });
    } catch (error) {
      this.deps.logger.error({
        msg: 'Settings OAuth commit failed',
        endpoint: 'HandleOAuthCallback',
        code: 'SETTINGS_CREDENTIAL_COMMIT_FAILED',
        userId: metadata.userId,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
      });
      return {
        success: false,
        nextState: 'SETTINGS_OAUTH',
        message: settingsCopies.retry(),
        canRetry: true,
      };
    }
    if (committed === 'stale') {
      return {
        success: false,
        nextState: 'SETTINGS_OAUTH',
        message: settingsCopies.retry(),
        canRetry: true,
      };
    }
    await this.cleanupSettings(payload);
    await this.sendSettingsMessage(metadata.externalId, settingsCopies.reauthorized());
    return { success: true, nextState: 'IDLE', message: settingsCopies.reauthorized() };
  }

  private async endSettingsFlow(
    observed: ConversationState,
    payload: SettingsOAuthPayload,
    expiry: 'unexpired' | 'expired',
  ): Promise<void> {
    const requiredExpiry =
      expiry === 'unexpired' && observed.expiresAt && observed.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : expiry;
    await this.deps.transitionState.execute({
      userId: observed.userId,
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
      expected: this.deps.transitionState.precondition(observed, requiredExpiry),
    });
    await this.cleanupSettings(payload);
  }

  private async cleanupSettings(payload: SettingsOAuthPayload): Promise<void> {
    await this.deps.settingsOAuthCleanup?.execute(payload);
  }

  private async sendSettingsMessage(externalId: string, message: string): Promise<void> {
    try {
      await this.deps.messagingPort.sendMessage(externalId, message);
    } catch (error) {
      this.deps.logger.error({
        msg: 'Settings OAuth chat message failed',
        endpoint: 'HandleOAuthCallback',
        code: 'SETTINGS_MESSAGE_FAILED',
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
      });
    }
  }

  private matchesPersistedNonce(
    state: Awaited<ReturnType<IConversationStateRepository['findByUserId']>>,
    nonce: string,
    revision: string,
  ): boolean {
    return (
      state?.currentState === 'ONBOARDING_DRIVE' &&
      state.revision === revision &&
      state.statePayload?.state === nonce
    );
  }

  private matchesSettingsNonce(
    state: ConversationState | null,
    nonce: string,
    metadata: OAuthStatePayload,
  ): boolean {
    const payload = parseSettingsOAuthPayload(state);
    return (
      !!payload &&
      state?.revision === metadata.revision &&
      payload.state === nonce &&
      payload.flowId === metadata.flowId
    );
  }
}
