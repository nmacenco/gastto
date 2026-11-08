import type { CandidateOAuthTokenRepository } from '../ports/CandidateOAuthTokenRepository';
import type { OAuthServicePort } from '../../domain/ports/oauth';
import type { TokenEncryptionPort } from '../../domain/ports/tokenEncryption';
import { SpreadsheetError } from '../../domain/errors/SpreadsheetError';
import { OAuthDeniedError } from '../../domain/errors/OAuthDeniedError';
import { OAuthNetworkError } from '../../domain/errors/OAuthNetworkError';

export class CandidateOAuthTokenService {
  constructor(
    private readonly tokens: CandidateOAuthTokenRepository,
    private readonly encryption: TokenEncryptionPort,
    private readonly oauth: OAuthServicePort,
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
    const access = this.encryption.encrypt(input.accessToken);
    const refresh = this.encryption.encrypt(input.refreshToken);
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
        return this.encryption.decrypt(token.accessTokenEnc, token.iv);
      } catch {
        throw new SpreadsheetError('Candidate Google token cannot be decrypted', {
          code: 'AUTH_ERROR',
        });
      }
    }
    try {
      const refreshToken = this.encryption.decrypt(token.refreshTokenEnc, token.refreshIv);
      const refreshed = await this.oauth.refreshAccessToken('google', refreshToken);
      const encrypted = this.encryption.encrypt(refreshed.accessToken);
      await this.tokens.markRefreshed(
        input.requestId,
        encrypted.ciphertext,
        encrypted.iv,
        refreshed.expiresAt,
      );
      return refreshed.accessToken;
    } catch (error) {
      if (error instanceof OAuthDeniedError) {
        await this.tokens.markRevoked(input.requestId);
        throw new SpreadsheetError('Candidate Google authorization was revoked', {
          code: 'AUTH_ERROR',
        });
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
