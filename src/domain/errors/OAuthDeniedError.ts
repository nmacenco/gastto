// LAYER: Domain
// Error thrown when the user denies OAuth authorization or explicitly cancels.

export class OAuthDeniedError extends Error {
  constructor(message: string = 'OAuth authorization was denied by the user') {
    super(message);
    this.name = 'OAuthDeniedError';
  }
}
