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

export interface HandleOAuthCallbackInput {
  code: string;
  state: string;
}

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
}

export class HandleOAuthCallback {
  constructor(private readonly deps: HandleOAuthCallbackDeps) {}

  async execute(input: HandleOAuthCallbackInput): Promise<HandleOAuthCallbackOutput> {
    const { code, state } = input;
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
      if (!this.matchesPersistedNonce(observed, state, metadata.revision)) {
        return {
          success: false,
          nextState: observed?.currentState ?? 'IDLE',
          message: onboardingCopies.oauthConnectionFailed(true),
          canRetry: true,
        };
      }

      return await this.deps.transitionState.runWithState(observed!, async () => {
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
        nextState: 'ONBOARDING_DRIVE',
        message: onboardingCopies.oauthConnectionFailed(true),
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
}
