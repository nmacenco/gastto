// LAYER: Infrastructure
// Google Drive OAuth adapter. Uses direct fetch calls to Google OAuth endpoints.
// Does not depend on google-auth-library to keep the dependency surface minimal.

import type { OAuthServicePort } from '../../../domain/ports/oauth';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import { OAuthDeniedError } from '../../../domain/errors/OAuthDeniedError';
import { OAuthNetworkError } from '../../../domain/errors/OAuthNetworkError';
import { OAuthStateMismatchError } from '../../../domain/errors/OAuthStateMismatchError';
import { InvalidProviderError } from '../../../domain/errors/InvalidProviderError';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const GOOGLE_OAUTH_SCOPES = [DRIVE_READONLY_SCOPE, GOOGLE_SHEETS_SCOPE].join(' ');

export interface GoogleDriveOAuthAdapterConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GoogleDriveOAuthAdapter implements OAuthServicePort {
  constructor(private readonly config: GoogleDriveOAuthAdapterConfig) {}

  buildAuthUrl(provider: SpreadsheetProvider, state: string, redirectUri: string): string {
    if (provider !== 'google') {
      throw new InvalidProviderError(provider);
    }

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_OAUTH_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(
    provider: SpreadsheetProvider,
    code: string,
    _state: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scope: string[];
  }> {
    if (provider !== 'google') {
      throw new InvalidProviderError(provider);
    }

    const body = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
    });

    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new OAuthNetworkError(`Network error during token exchange: ${String(err)}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new OAuthNetworkError(
        `Invalid JSON response from Google OAuth: HTTP ${response.status}`,
      );
    }

    if (!response.ok) {
      const errorCode = extractGoogleErrorCode(data);
      if (errorCode === 'access_denied') {
        throw new OAuthDeniedError('User denied Google Drive authorization');
      }
      if (errorCode === 'invalid_grant' || errorCode === 'redirect_uri_mismatch') {
        throw new OAuthStateMismatchError(`Google OAuth error: ${errorCode}`);
      }
      throw new OAuthNetworkError(`Google OAuth error (${errorCode}): HTTP ${response.status}`);
    }

    const parsed = parseTokenResponse(data);
    if (!parsed.refreshToken) {
      throw new OAuthNetworkError('Missing refresh_token in Google OAuth response');
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      scope: parsed.scope,
    };
  }

  async refreshAccessToken(
    provider: SpreadsheetProvider,
    refreshToken: string,
  ): Promise<{
    accessToken: string;
    expiresAt: Date;
    scope: string[];
  }> {
    if (provider !== 'google') {
      throw new InvalidProviderError(provider);
    }

    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
    });

    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new OAuthNetworkError(`Network error during token refresh: ${String(err)}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new OAuthNetworkError(
        `Invalid JSON response from Google OAuth: HTTP ${response.status}`,
      );
    }

    if (!response.ok) {
      const errorCode = extractGoogleErrorCode(data);
      if (errorCode === 'invalid_grant') {
        throw new OAuthDeniedError('Google OAuth refresh credential was rejected');
      }
      throw new OAuthNetworkError(
        `Google OAuth refresh error (${errorCode}): HTTP ${response.status}`,
      );
    }

    const parsed = parseTokenResponse(data);
    return {
      accessToken: parsed.accessToken,
      expiresAt: parsed.expiresAt,
      scope: parsed.scope,
    };
  }
}

function extractGoogleErrorCode(data: unknown): string {
  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as Record<string, unknown>).error === 'string'
  ) {
    return (data as Record<string, unknown>).error as string;
  }
  return 'unknown';
}

function parseTokenResponse(data: unknown): {
  accessToken: string;
  refreshToken: string | undefined;
  expiresAt: Date;
  scope: string[];
} {
  if (typeof data !== 'object' || data === null) {
    throw new OAuthNetworkError('Unexpected token response format from Google');
  }

  const obj = data as Record<string, unknown>;

  const accessToken = obj.access_token;
  if (typeof accessToken !== 'string') {
    throw new OAuthNetworkError('Missing access_token in Google OAuth response');
  }

  const refreshToken = typeof obj.refresh_token === 'string' ? obj.refresh_token : undefined;

  const expiresIn = obj.expires_in;
  if (typeof expiresIn !== 'number') {
    throw new OAuthNetworkError('Missing expires_in in Google OAuth response');
  }

  const scopeRaw = obj.scope;
  const scope =
    typeof scopeRaw === 'string'
      ? scopeRaw.split(' ').filter(Boolean)
      : Array.isArray(scopeRaw)
        ? scopeRaw.filter((s): s is string => typeof s === 'string')
        : [];

  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  return { accessToken, refreshToken, expiresAt, scope };
}
