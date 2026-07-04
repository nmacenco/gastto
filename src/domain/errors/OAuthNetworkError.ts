// LAYER: Domain
// Error thrown when an OAuth network or provider-side error occurs.

export class OAuthNetworkError extends Error {
  constructor(message: string = 'OAuth network error') {
    super(message);
    this.name = 'OAuthNetworkError';
  }
}
