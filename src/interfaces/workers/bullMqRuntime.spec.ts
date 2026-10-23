// LAYER: Interfaces

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { registerBullMqErrorListener, sanitizeRedisErrorMessage } from './bullMqRuntime';

describe('BullMQ runtime error sanitization', () => {
  it.each([
    [
      'connect rediss://default:super-secret@eu1.example.com:6379 failed',
      'connect [REDACTED] failed',
    ],
    [
      'connect valkeys://service-user:encoded%2Fsecret@valkey.example.com:26044 failed',
      'connect [REDACTED] failed',
    ],
    [
      'authentication failed password=hunter2 token: abc123',
      'authentication failed password=[REDACTED] token: [REDACTED]',
    ],
  ])('redacts credentials from an error message', (message, expected) => {
    expect(sanitizeRedisErrorMessage(message)).toBe(expected);
  });

  it('logs only the sanitized message from a BullMQ resource error', () => {
    const loggerError = vi.fn();
    let errorListener: ((error: Error) => void) | undefined;
    const resource = {
      on: vi.fn((_event: 'error', listener: (error: Error) => void) => {
        errorListener = listener;
      }),
    };

    registerBullMqErrorListener(resource, {
      logger: { error: loggerError } as unknown as Logger,
      queue: 'process-message',
      resourceKind: 'worker',
    });
    errorListener?.(new Error('connection to redis://default:password@redis.example failed'));

    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'connection to [REDACTED] failed' }),
    );
  });
});
