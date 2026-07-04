// LAYER: Infrastructure
// Adapter that wraps AES-256-GCM encryption for OAuth token storage (ADR-007).
// Implements the TokenEncryptionPort defined in the Domain layer.

import { decrypt as decryptAes, encrypt } from './aes256gcm';
import type { TokenEncryptionPort } from '../../domain/ports/tokenEncryption';

const KEY_LENGTH = 32; // 256-bit key

export class TokenEncryptionAdapter implements TokenEncryptionPort {
  private readonly key: Buffer;

  constructor(encryptionKeyHex: string) {
    this.key = Buffer.from(encryptionKeyHex, 'hex');
    if (this.key.length !== KEY_LENGTH) {
      throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (64 hex characters)`);
    }
  }

  encrypt(plaintext: string): { ciphertext: Buffer; iv: Buffer } {
    return encrypt(plaintext, this.key);
  }

  decrypt(ciphertext: Buffer, iv: Buffer): string {
    return decryptAes(ciphertext, iv, this.key);
  }
}
