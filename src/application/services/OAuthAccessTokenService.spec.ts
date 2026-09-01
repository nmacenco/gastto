// LAYER: Application / Tests

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthToken } from '../../domain/entities/SpreadsheetConfig';
import { OAuthDeniedError } from '../../domain/errors/OAuthDeniedError';
import { OAuthNetworkError } from '../../domain/errors/OAuthNetworkError';
import { SpreadsheetError } from '../../domain/errors/SpreadsheetError';
import type { OAuthServicePort } from '../../domain/ports/oauth';
import type { IOAuthTokenRepository } from '../../domain/ports/repositories';
import type { TokenEncryptionPort } from '../../domain/ports/tokenEncryption';
import { executeWithOAuthAccessToken, OAuthAccessTokenService } from './OAuthAccessTokenService';

const ACCESS = Buffer.from('encrypted-access');
const REFRESH = Buffer.from('encrypted-refresh');
const ACCESS_IV = Buffer.from('access-iv');
const REFRESH_IV = Buffer.from('refresh-iv');
const NEW_ACCESS = Buffer.from('encrypted-new-access');
const NEW_IV = Buffer.from('new-access-iv');
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const token: OAuthToken = {
  id: 'token-1',
  userId: 'user-1',
  provider: 'google',
  accessTokenEnc: ACCESS,
  refreshTokenEnc: REFRESH,
  iv: ACCESS_IV,
  refreshIv: REFRESH_IV,
  accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  scope: [SHEETS_SCOPE],
  grantedAt: new Date(),
  lastRefreshedAt: null,
  revokedAt: null,
};

const findByUserAndProvider = vi.fn();
const markRefreshed = vi.fn();
const markRevoked = vi.fn();
const encrypt = vi.fn();
const decrypt = vi.fn();
const refreshAccessToken = vi.fn();

function buildService(refreshWindowMs = 5 * 60 * 1000): OAuthAccessTokenService {
  const tokenRepository = {
    findByUserAndProvider,
    markRefreshed,
    markRevoked,
  } as unknown as IOAuthTokenRepository;
  const tokenEncryption = { encrypt, decrypt } as TokenEncryptionPort;
  const oauthService = { refreshAccessToken } as unknown as OAuthServicePort;
  return new OAuthAccessTokenService({
    tokenRepository,
    tokenEncryption,
    oauthService,
    refreshWindowMs,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findByUserAndProvider.mockResolvedValue({ ...token });
  decrypt.mockImplementation((ciphertext: Buffer) =>
    ciphertext === REFRESH ? 'refresh-plaintext' : 'access-plaintext',
  );
  encrypt.mockReturnValue({ ciphertext: NEW_ACCESS, iv: NEW_IV });
  refreshAccessToken.mockResolvedValue({
    accessToken: 'new-access-plaintext',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scope: [SHEETS_SCOPE],
  });
});

describe('OAuthAccessTokenService', () => {
  it('reuses and decrypts a token outside the refresh window', async () => {
    const result = await buildService().getValidAccessToken({
      userId: 'user-1',
      provider: 'google',
      requiredScopes: [SHEETS_SCOPE],
    });

    expect(result).toEqual({
      accessToken: 'access-plaintext',
      expiresAt: token.accessTokenExpiresAt,
      refreshed: false,
    });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    ['within the safety window', new Date(Date.now() + 4 * 60 * 1000)],
    ['already expired', new Date(Date.now() - 1)],
  ])('refreshes when the token is %s', async (_label, expiresAt) => {
    findByUserAndProvider.mockResolvedValue({ ...token, accessTokenExpiresAt: expiresAt });
    const result = await buildService().getValidAccessToken({
      userId: 'user-1',
      provider: 'google',
    });

    expect(decrypt).toHaveBeenCalledWith(REFRESH, REFRESH_IV);
    expect(refreshAccessToken).toHaveBeenCalledWith('google', 'refresh-plaintext');
    expect(encrypt).toHaveBeenCalledWith('new-access-plaintext');
    expect(markRefreshed).toHaveBeenCalledWith('token-1', NEW_ACCESS, NEW_IV, result.expiresAt);
    expect(result).toMatchObject({ accessToken: 'new-access-plaintext', refreshed: true });
  });

  it.each([
    ['missing', null],
    ['revoked', { ...token, revokedAt: new Date() }],
  ])('returns AUTH_ERROR for a %s credential', async (_label, storedToken) => {
    findByUserAndProvider.mockResolvedValue(storedToken);
    await expect(
      buildService().getValidAccessToken({ userId: 'user-1', provider: 'google' }),
    ).rejects.toMatchObject({ code: 'AUTH_ERROR', retryable: false });
  });

  it('returns AUTH_ERROR when a required scope is missing', async () => {
    await expect(
      buildService().getValidAccessToken({
        userId: 'user-1',
        provider: 'google',
        requiredScopes: ['missing-scope'],
      }),
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('returns AUTH_ERROR when an access token cannot be decrypted', async () => {
    decrypt.mockImplementation(() => {
      throw new Error('secret material must not escape');
    });
    await expect(
      buildService().getValidAccessToken({ userId: 'user-1', provider: 'google' }),
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' });
  });

  it('marks a rejected refresh credential revoked and returns AUTH_ERROR', async () => {
    findByUserAndProvider.mockResolvedValue({ ...token, accessTokenExpiresAt: new Date(0) });
    refreshAccessToken.mockRejectedValue(new OAuthDeniedError('rejected'));

    await expect(
      buildService().getValidAccessToken({ userId: 'user-1', provider: 'google' }),
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(markRevoked).toHaveBeenCalledWith('token-1');
    expect(markRefreshed).not.toHaveBeenCalled();
  });

  it('keeps credentials active on a transient refresh failure', async () => {
    findByUserAndProvider.mockResolvedValue({ ...token, accessTokenExpiresAt: new Date(0) });
    refreshAccessToken.mockRejectedValue(new OAuthNetworkError('temporary'));

    await expect(
      buildService().getValidAccessToken({ userId: 'user-1', provider: 'google' }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    expect(markRevoked).not.toHaveBeenCalled();
  });

  it('forces one refresh and retries an operation once after AUTH_ERROR', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new SpreadsheetError('expired', { code: 'AUTH_ERROR' }))
      .mockResolvedValueOnce('saved');

    const result = await executeWithOAuthAccessToken(
      buildService(),
      { userId: 'user-1', provider: 'google' },
      operation,
    );

    expect(result).toBe('saved');
    expect(operation).toHaveBeenNthCalledWith(1, 'access-plaintext');
    expect(operation).toHaveBeenNthCalledWith(2, 'new-access-plaintext');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not refresh or retry non-authorization operation failures', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(
        new SpreadsheetError('offline', { code: 'NETWORK_ERROR', retryable: true }),
      );

    await expect(
      executeWithOAuthAccessToken(
        buildService(),
        { userId: 'user-1', provider: 'google' },
        operation,
      ),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('never includes plaintext credentials in surfaced errors', async () => {
    findByUserAndProvider.mockResolvedValue({ ...token, accessTokenExpiresAt: new Date(0) });
    refreshAccessToken.mockRejectedValue(new OAuthDeniedError('refresh-plaintext'));

    const error = await buildService()
      .getValidAccessToken({ userId: 'user-1', provider: 'google' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpreadsheetError);
    expect(String(error)).not.toContain('refresh-plaintext');
    expect(String(error)).not.toContain('access-plaintext');
  });
});
