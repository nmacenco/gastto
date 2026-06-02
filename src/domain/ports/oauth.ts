// LAYER: Domain
// OAuth service port. Allows the Application layer to initiate and
// complete OAuth flows without coupling to Google/Microsoft specifics.

import type { SpreadsheetProvider } from '../entities/SpreadsheetConfig';

export interface OAuthServicePort {
  /** Builds the provider-specific OAuth authorization URL. */
  buildAuthUrl(provider: SpreadsheetProvider, state: string, redirectUri: string): string;

  /** Exchanges an authorization code for tokens and validates the state parameter. */
  exchangeCode(
    provider: SpreadsheetProvider,
    code: string,
    state: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scope: string[];
  }>;
}
