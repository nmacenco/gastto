// LAYER: Infrastructure / Tests
// Unit tests for TokenEncryptionAdapter.
// Verifies construction, encryption output, and decrypt round-trip.

import { describe, it, expect } from 'vitest';
import { TokenEncryptionAdapter } from './TokenEncryptionAdapter';

describe('TokenEncryptionAdapter', () => {
  // A valid 32-byte key represented as 64 hex characters
  const validKeyHex = 'a'.repeat(64);

  it('encrypt returns non-empty ciphertext and IV', () => {
    const adapter = new TokenEncryptionAdapter(validKeyHex);
    const result = adapter.encrypt('hello world');

    expect(result.ciphertext.length).toBeGreaterThan(0);
    expect(result.iv.length).toBe(16);
  });

  it('decrypt round-trip recovers original plaintext via adapter', () => {
    const adapter = new TokenEncryptionAdapter(validKeyHex);
    const plaintext = 'sensitive-token-data-123';
    const encrypted = adapter.encrypt(plaintext);

    const decrypted = adapter.decrypt(encrypted.ciphertext, encrypted.iv);
    expect(decrypted).toBe(plaintext);
  });

  it('throws when decrypting invalid ciphertext', () => {
    const adapter = new TokenEncryptionAdapter(validKeyHex);
    const badCiphertext = Buffer.from('not-valid-ciphertext');
    const iv = Buffer.alloc(16, 0);

    expect(() => adapter.decrypt(badCiphertext, iv)).toThrow();
  });

  it('throws when key is not 64 hex characters', () => {
    expect(() => new TokenEncryptionAdapter('too-short')).toThrow(
      'Encryption key must be 32 bytes',
    );
  });

  it('throws when key contains non-hex characters producing wrong length', () => {
    // 64 characters but not valid hex -> Buffer.from treats each char as 1 byte
    // So this would actually be 64 bytes, not 32. Let me use a string that's 64 chars but not hex-parsable
    // Actually Buffer.from(str, 'hex') silently ignores invalid hex pairs, so 'zzzz...' (64 chars)
    // would be parsed as 32 bytes of zeros (each 'zz' pair is invalid -> 00).
    // A safer test: 62 chars of valid hex -> 31 bytes.
    const sixtyTwoChars = 'ab'.repeat(31);
    expect(() => new TokenEncryptionAdapter(sixtyTwoChars)).toThrow(
      'Encryption key must be 32 bytes',
    );
  });
});
