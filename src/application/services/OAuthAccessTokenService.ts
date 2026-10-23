// LAYER: Application
// Centralized OAuth access-token lifecycle. Keeps refresh/decryption policy out
// of spreadsheet use cases and exposes plaintext only to the immediate caller.

import type { SpreadsheetProvider } from '../../domain/entities/SpreadsheetConfig';
import { OAuthDeniedError } from '../../domain/errors/OAuthDeniedError';
import { OAuthNetworkError } from '../../domain/errors/OAuthNetworkError';
import { SpreadsheetError } from '../../domain/errors/SpreadsheetError';
import type { OAuthServicePort } from '../../domain/ports/oauth';
import type { IOAuthTokenRepository } from '../../domain/ports/repositories';
import type { TokenEncryptionPort } from '../../domain/ports/tokenEncryption';

const DEFAULT_REFRESH_WINDOW_MS = 5 * 60 * 1000;

export interface OAuthAccessTokenInput {
  userId: string;
  provider: SpreadsheetProvider;
  requiredScopes?: string[];
}

export interface OAuthAccessTokenResult {
  accessToken: string;
  expiresAt: Date;
  refreshed: boolean;
}

export interface OAuthAccessTokenServiceDeps {
  tokenRepository: IOAuthTokenRepository;
  tokenEncryption: TokenEncryptionPort;
  oauthService: OAuthServicePort;
  refreshWindowMs?: number;
}

export interface OAuthAccessTokenProvider {
  getValidAccessToken(input: OAuthAccessTokenInput): Promise<OAuthAccessTokenResult>;
  forceRefreshAccessToken(
    input: OAuthAccessTokenInput,
  ): Promise<OAuthAccessTokenResult & { refreshed: true }>;
}

export class OAuthAccessTokenService implements OAuthAccessTokenProvider {
  private readonly refreshWindowMs: number;

  constructor(private readonly deps: OAuthAccessTokenServiceDeps) {
    this.refreshWindowMs = deps.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
  }

  async getValidAccessToken(input: OAuthAccessTokenInput): Promise<OAuthAccessTokenResult> {
    const token = await this.loadUsableToken(input);
    if (token.accessTokenExpiresAt.getTime() <= Date.now() + this.refreshWindowMs) {
      return this.refreshToken(input, token);
    }

    try {
      return {
        accessToken: this.deps.tokenEncryption.decrypt(token.accessTokenEnc, token.iv),
        expiresAt: token.accessTokenExpiresAt,
        refreshed: false,
      };
    } catch {
      throw this.authorizationError('Stored OAuth access token cannot be decrypted');
    }
  }

  async forceRefreshAccessToken(
    input: OAuthAccessTokenInput,
  ): Promise<OAuthAccessTokenResult & { refreshed: true }> {
    const token = await this.loadUsableToken(input);
    return this.refreshToken(input, token);
  }

  private async loadUsableToken(input: OAuthAccessTokenInput) {
    const token = await this.deps.tokenRepository.findByUserAndProvider(
      input.userId,
      input.provider,
    );
    if (!token || token.revokedAt) {
      throw this.authorizationError('No active spreadsheet authorization is available');
    }

    if (input.requiredScopes?.some((scope) => !token.scope.includes(scope))) {
      throw this.authorizationError('Spreadsheet authorization is missing a required scope');
    }

    return token;
  }

  private async refreshToken(
    input: OAuthAccessTokenInput,
    token: NonNullable<Awaited<ReturnType<IOAuthTokenRepository['findByUserAndProvider']>>>,
  ): Promise<OAuthAccessTokenResult & { refreshed: true }> {
    let refreshToken: string;
    try {
      refreshToken = this.deps.tokenEncryption.decrypt(token.refreshTokenEnc, token.refreshIv);
    } catch {
      throw this.authorizationError('Stored OAuth refresh token cannot be decrypted');
    }

    try {
      const refreshed = await this.deps.oauthService.refreshAccessToken(
        input.provider,
        refreshToken,
      );
      const encrypted = this.deps.tokenEncryption.encrypt(refreshed.accessToken);
      await this.deps.tokenRepository.markRefreshed(
        token.id,
        encrypted.ciphertext,
        encrypted.iv,
        refreshed.expiresAt,
      );
      return {
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
        refreshed: true,
      };
    } catch (error) {
      if (error instanceof OAuthDeniedError) {
        await this.deps.tokenRepository.markRevoked(token.id);
        throw this.authorizationError('Spreadsheet authorization must be renewed');
      }
      if (error instanceof OAuthNetworkError) {
        throw new SpreadsheetError('OAuth provider could not refresh spreadsheet access', {
          code: 'NETWORK_ERROR',
          retryable: true,
        });
      }
      if (error instanceof SpreadsheetError) throw error;
      throw new SpreadsheetError('Unexpected OAuth token refresh failure', {
        code: 'NETWORK_ERROR',
        retryable: true,
      });
    }
  }

  private authorizationError(message: string): SpreadsheetError {
    return new SpreadsheetError(message, { code: 'AUTH_ERROR' });
  }
}

export async function executeWithOAuthAccessToken<T>(
  tokenService: OAuthAccessTokenProvider,
  input: OAuthAccessTokenInput,
  operation: (accessToken: string) => Promise<T>,
): Promise<T> {
  const initial = await tokenService.getValidAccessToken(input);
  try {
    return await operation(initial.accessToken);
  } catch (error) {
    if (!(error instanceof SpreadsheetError) || error.code !== 'AUTH_ERROR') throw error;
    const refreshed = await tokenService.forceRefreshAccessToken(input);
    return operation(refreshed.accessToken);
  }
}
