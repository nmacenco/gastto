import type { OAuthServicePort } from '../../../domain/ports/oauth';
import type { TokenEncryptionPort } from '../../../domain/ports/tokenEncryption';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';

export interface EncryptedAccountCredential {
  provider: SpreadsheetProvider;
  refreshTokenEnc: Buffer;
  refreshIv: Buffer;
}

export interface AccountCredentialStore {
  list(userId: string): Promise<EncryptedAccountCredential[]>;
  deleteAll(userId: string): Promise<void>;
}

export class RevokeAccountCredentials {
  constructor(
    private readonly store: AccountCredentialStore,
    private readonly encryption: TokenEncryptionPort,
    private readonly oauth: Pick<OAuthServicePort, 'revokeToken'>,
  ) {}

  async execute(
    userId: string,
  ): Promise<{ remoteRevocationFailed: boolean; credentialsPresent: boolean }> {
    const credentials = await this.store.list(userId);
    let remoteRevocationFailed = false;
    try {
      for (const credential of credentials) {
        try {
          const token = this.encryption.decrypt(credential.refreshTokenEnc, credential.refreshIv);
          const result = await this.oauth.revokeToken(credential.provider, token);
          if (result !== 'revoked') remoteRevocationFailed = true;
        } catch {
          remoteRevocationFailed = true;
        }
      }
    } finally {
      // Local ciphertext must be removed even when Google is unavailable.
      await this.store.deleteAll(userId);
    }
    return { remoteRevocationFailed, credentialsPresent: credentials.length > 0 };
  }
}
