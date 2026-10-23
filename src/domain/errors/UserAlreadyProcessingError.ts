// LAYER: Domain
// Typed error for per-user processing lock contention.
// The thick worker catches this and rethrows to trigger
// BullMQ retry with a custom backoff strategy.

export class UserAlreadyProcessingError extends Error {
  constructor(public readonly userId: string) {
    super(`User ${userId} is already being processed`);
    this.name = 'UserAlreadyProcessingError';
  }
}
