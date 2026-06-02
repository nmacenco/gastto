// LAYER: Infrastructure
// AES-256-GCM encryption utility for OAuth token storage (ADR-007).
// Auth tag is appended to the ciphertext so only two fields are needed
// in the database: ciphertext (with tag) and IV.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV for GCM
const TAG_LENGTH = 16; // 128-bit auth tag
const KEY_LENGTH = 32; // 256-bit key

export function encrypt(plaintext: string, key: Buffer): { ciphertext: Buffer; iv: Buffer } {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (256 bits)`);
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Append auth tag to the end of ciphertext for compact storage
  const ciphertext = Buffer.concat([encrypted, tag]);

  return { ciphertext, iv };
}

export function decrypt(ciphertext: Buffer, iv: Buffer, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (256 bits)`);
  }
  if (iv.length !== IV_LENGTH) {
    throw new Error(`IV must be ${IV_LENGTH} bytes`);
  }
  if (ciphertext.length < TAG_LENGTH) {
    throw new Error('Ciphertext too short to contain auth tag');
  }

  const encrypted = ciphertext.subarray(0, -TAG_LENGTH);
  const tag = ciphertext.subarray(-TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
