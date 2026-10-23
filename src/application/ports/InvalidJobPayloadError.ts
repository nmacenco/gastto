// LAYER: Application

export class InvalidJobPayloadError extends Error {
  readonly code = 'INVALID_JOB_PAYLOAD';

  constructor(
    readonly queue: string,
    readonly paths: readonly string[],
  ) {
    super(`Invalid ${queue} job payload`);
    this.name = 'InvalidJobPayloadError';
  }
}
