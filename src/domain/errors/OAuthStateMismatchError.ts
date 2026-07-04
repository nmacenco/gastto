// LAYER: Domain
// Error thrown when the OAuth state parameter does not match the expected value.

export class OAuthStateMismatchError extends Error {
  constructor(message: string = 'OAuth state mismatch') {
    super(message);
    this.name = 'OAuthStateMismatchError';
  }
}
