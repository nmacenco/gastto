// LAYER: Infrastructure
// Shared log/Sentry sensitive-data policy. Keep this module dependency-free so
// it can run before application initialization and be unit-tested in isolation.

import type { ErrorEvent } from '@sentry/node';
import type { LoggerOptions } from 'pino';

export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY =
  /(?:authorization|cookie|token|secret|password|api[_-]?key|oauth.*state|state|raw(?:message|payload)|job(?:data)?|payload|body|errorbody)/i;
const MAX_DEPTH = 12;
const MAX_ENTRIES = 200;

/** Pino paths used by both the root logger and Fastify's request logger. */
type PinoRedactionOptions = Exclude<NonNullable<LoggerOptions['redact']>, string[]>;

export const pinoRedaction: PinoRedactionOptions = {
  paths: [
    'authorization',
    'cookie',
    'headers.authorization',
    'headers.cookie',
    'req.headers.authorization',
    'req.headers.cookie',
    '*.authorization',
    '*.cookie',
    '*.token',
    '*.secret',
    '*.password',
    '*.accessToken',
    '*.refreshToken',
    '*.apiKey',
    '*.oauthState',
    '*.state',
    '*.rawMessage',
    '*.rawPayload',
    '*.jobData',
    '*.errorBody',
    '*.payload',
    '*.body',
  ],
  censor: REDACTED_VALUE,
};

export function isSensitiveField(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/**
 * Produces a bounded, cycle-safe clone of a Sentry event with sensitive fields
 * removed. `beforeSend` must never throw, even for malformed SDK metadata.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  return scrubValue(event, new WeakSet<object>(), 0) as ErrorEvent;
}

function scrubValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ENTRIES).map((item) => scrubValue(item, seen, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, MAX_ENTRIES)) {
    output[key] = isSensitiveField(key) ? REDACTED_VALUE : scrubValue(child, seen, depth + 1);
  }
  return output;
}
