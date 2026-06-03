// LAYER: Domain
// Port for encrypting sensitive tokens before persistence.
// Implementation lives in Infrastructure (AES-256-GCM, ADR-007).

export interface TokenEncryptionPort {
  encrypt(plaintext: string): { ciphertext: Buffer; iv: Buffer };
}
