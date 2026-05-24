// LAYER: Domain
// Shared domain error for value object and entity validation failures.

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}
