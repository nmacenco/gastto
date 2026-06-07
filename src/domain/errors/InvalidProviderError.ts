// LAYER: Domain
// Error thrown when an unsupported OAuth provider is requested.

export class InvalidProviderError extends Error {
  constructor(public readonly provider: string) {
    super(`Invalid provider: ${provider}`);
    this.name = 'InvalidProviderError';
  }
}
