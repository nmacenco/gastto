import type { CandidateOAuthTokenRepository } from '../ports/CandidateOAuthTokenRepository';
import type { OAuthServicePort } from '../../domain/ports/oauth';
import type { TokenEncryptionPort } from '../../domain/ports/tokenEncryption';
import { SpreadsheetError } from '../../domain/errors/SpreadsheetError';
import { OAuthDeniedError } from '../../domain/errors/OAuthDeniedError';
import { OAuthNetworkError } from '../../domain/errors/OAuthNetworkError';
import type { AccountExternalWorkFence } from '../ports/AccountExternalWorkFence';
import { AccountDeletionInProgressError } from '../ports/AccountExternalWorkFence';

export class CandidateOAuthTokenService {
  constructor(
    private readonly tokens: CandidateOAuthTokenRepository,
    private readonly encryption: TokenEncryptionPort,
    private readonly oauth: OAuthServicePort,
    private readonly accountDeletion?: { isDeleting(userId: string): Promise<boolean> },
    private readonly accountExternalWorkFence?: AccountExternalWorkFence,
  ) {}

  async discard(requestId: string): Promise<void> {
    await this.tokens.delete(requestId);
  }

  async save(input: {
    requestId: string;
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scope: string[];
  }): Promise<void> {
    if (await this.accountDeletion?.isDeleting(input.userId)) {
      throw new SpreadsheetError('Account authorization is unavailable', { code: 'AUTH_ERROR' });
    }
    const access = this.encryption.encrypt(input.accessToken);
    const refresh = this.encryption.encrypt(input.refreshToken);
    if (await this.accountDeletion?.isDeleting(input.userId)) {
      throw new SpreadsheetError('Account authorization is unavailable', { code: 'AUTH_ERROR' });
    }
    await this.tokens.upsert({
      requestId: input.requestId,
      userId: input.userId,
      accessTokenEnc: access.ciphertext,
      refreshTokenEnc: refresh.ciphertext,
      iv: access.iv,
      refreshIv: refresh.iv,
      accessTokenExpiresAt: input.expiresAt,
      scope: input.scope,
      grantedAt: new Date(),
      lastRefreshedAt: null,
      revokedAt: null,
    });
  }

  async getValidAccessToken(input: {
    requestId: string;
    userId: string;
    requiredScopes?: string[];
  }): Promise<string> {
    if (await this.accountDeletion?.isDeleting(input.userId)) {
      throw new SpreadsheetError('Account authorization is unavailable', { code: 'AUTH_ERROR' });
    }
    const token = await this.tokens.findByRequestId(input.requestId);
    if (
      !token ||
      token.userId !== input.userId ||
      token.revokedAt ||
      input.requiredScopes?.some((scope) => !token.scope.includes(scope))
    ) {
      throw new SpreadsheetError('Candidate Google authorization is unavailable', {
        code: 'AUTH_ERROR',
      });
    }
    if (token.accessTokenExpiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      try {
        const accessToken = this.encryption.decrypt(token.accessTokenEnc, token.iv);
        if (await this.accountDeletion?.isDeleting(input.userId)) {
          throw new SpreadsheetError('Account authorization is unavailable', {
            code: 'AUTH_ERROR',
          });
        }
        return accessToken;
      } catch (error) {
        if (error instanceof SpreadsheetError) throw error;
        throw new SpreadsheetError('Candidate Google token cannot be decrypted', {
          code: 'AUTH_ERROR',
        });
      }
    }
    try {
      const refresh = async () => {
        const refreshToken = this.encryption.decrypt(token.refreshTokenEnc, token.refreshIv);
        let refreshed: Awaited<ReturnType<OAuthServicePort['refreshAccessToken']>>;
        try {
          refreshed = await this.oauth.refreshAccessToken('google', refreshToken);
        } catch (error) {
          if (error instanceof OAuthDeniedError) {
            await this.tokens.markRevoked(input.requestId);
            throw new SpreadsheetError('Candidate Google authorization was revoked', {
              code: 'AUTH_ERROR',
            });
          }
          throw error;
        }
        if (await this.accountDeletion?.isDeleting(input.userId)) {
          throw new SpreadsheetError('Account authorization is unavailable', {
            code: 'AUTH_ERROR',
          });
        }
        const encrypted = this.encryption.encrypt(refreshed.accessToken);
        await this.tokens.markRefreshed(
          input.requestId,
          encrypted.ciphertext,
          encrypted.iv,
          refreshed.expiresAt,
        );
        return refreshed.accessToken;
      };
      return this.accountExternalWorkFence
        ? await this.accountExternalWorkFence.run(input.userId, refresh)
        : await refresh();
    } catch (error) {
      if (error instanceof AccountDeletionInProgressError) {
        throw new SpreadsheetError('Account authorization is unavailable', { code: 'AUTH_ERROR' });
      }
      if (error instanceof OAuthNetworkError) {
        throw new SpreadsheetError('Candidate Google refresh failed', {
          code: 'NETWORK_ERROR',
          retryable: true,
        });
      }
      if (error instanceof SpreadsheetError) throw error;
      throw new SpreadsheetError('Candidate Google refresh failed', {
        code: 'NETWORK_ERROR',
        retryable: true,
      });
    }
  }
}
