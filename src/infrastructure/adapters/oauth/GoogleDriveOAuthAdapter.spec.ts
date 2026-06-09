// LAYER: Infrastructure / Tests
// Contract tests for GoogleDriveOAuthAdapter.
// Mocks the global fetch API so no real Google calls are made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleDriveOAuthAdapter } from './GoogleDriveOAuthAdapter';
import { OAuthDeniedError } from '../../../domain/errors/OAuthDeniedError';
import { OAuthNetworkError } from '../../../domain/errors/OAuthNetworkError';
import { OAuthStateMismatchError } from '../../../domain/errors/OAuthStateMismatchError';
import { InvalidProviderError } from '../../../domain/errors/InvalidProviderError';

const CONFIG = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:3000/auth/google/callback',
};

describe('GoogleDriveOAuthAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildAuthUrl', () => {
    it('returns a valid Google OAuth URL with state and redirect_uri', () => {
      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      const url = adapter.buildAuthUrl(
        'google',
        'csrf-state-123',
        'http://localhost:3000/auth/google/callback',
      );

      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://accounts.google.com');
      expect(parsed.pathname).toBe('/o/oauth2/v2/auth');
      expect(parsed.searchParams.get('client_id')).toBe(CONFIG.clientId);
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/auth/google/callback',
      );
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('scope')).toBe(
        'https://www.googleapis.com/auth/drive.readonly',
      );
      expect(parsed.searchParams.get('access_type')).toBe('offline');
      expect(parsed.searchParams.get('prompt')).toBe('consent');
      expect(parsed.searchParams.get('state')).toBe('csrf-state-123');
    });

    it('throws InvalidProviderError for non-google providers', () => {
      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      expect(() => adapter.buildAuthUrl('microsoft', 'state', 'http://localhost/callback')).toThrow(
        InvalidProviderError,
      );
    });
  });

  describe('exchangeCode', () => {
    it('exchanges a code for tokens on successful response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: 'access-123',
            refresh_token: 'refresh-456',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/drive.readonly',
          }),
      });

      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      const result = await adapter.exchangeCode('google', 'auth-code', 'csrf-state-123');

      expect(result.accessToken).toBe('access-123');
      expect(result.refreshToken).toBe('refresh-456');
      expect(result.scope).toEqual(['https://www.googleapis.com/auth/drive.readonly']);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://oauth2.googleapis.com/token');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });

      const body = new URLSearchParams(init.body as string);
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('client_id')).toBe(CONFIG.clientId);
      expect(body.get('client_secret')).toBe(CONFIG.clientSecret);
      expect(body.get('redirect_uri')).toBe(CONFIG.redirectUri);
      expect(body.get('grant_type')).toBe('authorization_code');
    });

    it('throws OAuthDeniedError when Google returns access_denied', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'access_denied', error_description: 'User denied' }),
      });

      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      await expect(adapter.exchangeCode('google', 'code', 'state')).rejects.toBeInstanceOf(
        OAuthDeniedError,
      );
    });

    it('throws OAuthStateMismatchError on invalid_grant', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'invalid_grant' }),
      });

      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      await expect(adapter.exchangeCode('google', 'code', 'state')).rejects.toBeInstanceOf(
        OAuthStateMismatchError,
      );
    });

    it('throws OAuthStateMismatchError on redirect_uri_mismatch', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'redirect_uri_mismatch' }),
      });

      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      await expect(adapter.exchangeCode('google', 'code', 'state')).rejects.toBeInstanceOf(
        OAuthStateMismatchError,
      );
    });

    it('throws OAuthNetworkError on non-2xx HTTP without known error code', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'server_error' }),
      });

      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      await expect(adapter.exchangeCode('google', 'code', 'state')).rejects.toBeInstanceOf(
        OAuthNetworkError,
      );
    });

    it('throws OAuthNetworkError on invalid JSON response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      await expect(adapter.exchangeCode('google', 'code', 'state')).rejects.toBeInstanceOf(
        OAuthNetworkError,
      );
    });

    it('throws OAuthNetworkError on fetch network failure', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      await expect(adapter.exchangeCode('google', 'code', 'state')).rejects.toBeInstanceOf(
        OAuthNetworkError,
      );
    });

    it('throws InvalidProviderError for non-google providers', async () => {
      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      await expect(adapter.exchangeCode('microsoft', 'code', 'state')).rejects.toBeInstanceOf(
        InvalidProviderError,
      );
    });
  });

  describe('refreshToken', () => {
    it('returns new access token on successful refresh', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-789',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/drive.readonly',
          }),
      });

      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      const result = await adapter.refreshToken('refresh-456');

      expect(result.accessToken).toBe('new-access-789');
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(result.scope).toEqual(['https://www.googleapis.com/auth/drive.readonly']);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://oauth2.googleapis.com/token');
      const body = new URLSearchParams(init.body as string);
      expect(body.get('refresh_token')).toBe('refresh-456');
      expect(body.get('grant_type')).toBe('refresh_token');
    });

    it('throws OAuthNetworkError on refresh failure', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'invalid_grant' }),
      });

      const adapter = new GoogleDriveOAuthAdapter(CONFIG);
      await expect(adapter.refreshToken('bad-refresh')).rejects.toBeInstanceOf(OAuthNetworkError);
    });
  });
});
