// LAYER: Interfaces
// Shared BullMQ runtime configuration and structured infrastructure error logging.

import type { Logger } from 'pino';

export const BULLMQ_WORKER_DRAIN_DELAY_SECONDS = 30;

const REDACTED_ERROR_VALUE = '[REDACTED]';
const REDIS_URL_PATTERN = /\b(?:redis|rediss|valkey|valkeys):\/\/[^\s'"<>]+/giu;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(password|passwd|token|secret|api[_-]?key)\b(\s*[:=]\s*)([^\s,;]+)/giu;

export function sanitizeRedisErrorMessage(message: string): string {
  return message
    .replace(REDIS_URL_PATTERN, REDACTED_ERROR_VALUE)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, key: string, separator: string) => {
      return `${key}${separator}${REDACTED_ERROR_VALUE}`;
    });
}

type BullMqResourceKind = 'queue' | 'worker';

interface BullMqErrorEmitter {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

interface RegisterBullMqErrorListenerOptions {
  logger: Logger;
  queue: string;
  resourceKind: BullMqResourceKind;
}

export function registerBullMqErrorListener(
  resource: BullMqErrorEmitter,
  options: RegisterBullMqErrorListenerOptions,
): void {
  resource.on('error', (error) => {
    const causeCode = (error as NodeJS.ErrnoException).code;

    options.logger.error({
      msg: `BullMQ ${options.resourceKind} error`,
      endpoint: 'bullmq',
      code: options.resourceKind === 'worker' ? 'BULLMQ_WORKER_ERROR' : 'BULLMQ_QUEUE_ERROR',
      queue: options.queue,
      error: sanitizeRedisErrorMessage(error.message),
      ...(causeCode === undefined ? {} : { causeCode }),
    });
  });
}
