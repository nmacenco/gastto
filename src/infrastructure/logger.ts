// LAYER: Infrastructure
// Shared Pino logger factory.
// Creates a structured JSON logger. In non-production environments,
// pino-pretty transport is enabled for human-readable output.
//
// Usage in main.ts:
//   import { createLogger } from '@infrastructure/logger';
//   const rootLogger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV !== 'production' });
//
// Downstream components receive the logger via constructor injection.
// Tests inject a silent or mock logger — never test Pino log formatting
// (docs/testing/guidelines.md line 113).

import pino, { type Logger } from 'pino';

export interface CreateLoggerOptions {
  level?: string;
  pretty?: boolean;
}

export function createLogger(opts?: CreateLoggerOptions): Logger {
  const level = opts?.level ?? 'info';
  const pretty = opts?.pretty ?? false;

  return pino({
    level,
    ...(pretty && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  });
}
