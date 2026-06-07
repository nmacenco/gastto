// LAYER: Infrastructure / Tests
// Unit tests for AES-256-GCM encryption utility.

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './aes256gcm';

const VALID_KEY = Buffer.from('a'.repeat(64), 'hex'); // 32 bytes
const INVALID_KEY_SHORT = Buffer.from('a'.repeat(32), 'hex'); // 16 bytes

describe('aes256gcm', () => {
  describe('encrypt', () => {
    it('produces ciphertext and IV for valid input', () => {
      const result = encrypt('sensitive-token', VALID_KEY);

      expect(result.ciphertext).toBeInstanceOf(Buffer);
      expect(result.ciphertext.length).toBeGreaterThan(16); // > auth tag
      expect(result.iv).toBeInstanceOf(Buffer);
      expect(result.iv.length).toBe(16);
    });

    it('produces different ciphertexts for the same plaintext', () => {
      const r1 = encrypt('same-plaintext', VALID_KEY);
      const r2 = encrypt('same-plaintext', VALID_KEY);

      expect(r1.ciphertext.toString('hex')).not.toBe(r2.ciphertext.toString('hex'));
      expect(r1.iv.toString('hex')).not.toBe(r2.iv.toString('hex'));
    });

    it('throws for a key shorter than 32 bytes', () => {
      expect(() => encrypt('plain', INVALID_KEY_SHORT)).toThrow('32 bytes');
    });
  });

  describe('decrypt', () => {
    it('round-trips a plaintext correctly', () => {
      const original = 'my-oauth-access-token';
      const { ciphertext, iv } = encrypt(original, VALID_KEY);
      const decrypted = decrypt(ciphertext, iv, VALID_KEY);

      expect(decrypted).toBe(original);
    });

    it('throws when ciphertext has been tampered with', () => {
      const { ciphertext, iv } = encrypt('original', VALID_KEY);
      const lastIndex = ciphertext.length - 1;
      ciphertext[lastIndex] = ciphertext[lastIndex]! ^ 0xff; // flip last byte of tag

      expect(() => decrypt(ciphertext, iv, VALID_KEY)).toThrow();
    });

    it('throws for wrong key length', () => {
      const { ciphertext, iv } = encrypt('original', VALID_KEY);

      expect(() => decrypt(ciphertext, iv, INVALID_KEY_SHORT)).toThrow('32 bytes');
    });

    it('throws for wrong IV length', () => {
      const { ciphertext } = encrypt('original', VALID_KEY);

      expect(() => decrypt(ciphertext, Buffer.alloc(8), VALID_KEY)).toThrow('16 bytes');
    });

    it('throws for ciphertext shorter than auth tag', () => {
      expect(() => decrypt(Buffer.alloc(8), Buffer.alloc(16), VALID_KEY)).toThrow('too short');
    });
  });
});
