import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/node';
import pino from 'pino';
import Fastify from 'fastify';

import {
  REDACTED_VALUE,
  pinoRedaction,
  scrubSentryEvent,
  scrubLogObject,
  pinoHooks,
} from './sensitiveData';

describe('scrubSentryEvent', () => {
  it('defines matching Pino redaction paths for request and application secrets', () => {
    expect(pinoRedaction.censor).toBe(REDACTED_VALUE);
    expect(pinoRedaction.paths).toContain('req.headers.authorization');
    expect(pinoRedaction.paths).toContain('req.url');
    expect(pinoRedaction.paths).toContain('*.token');
    expect(pinoRedaction.paths).toContain('*.rawMessage');
    expect(pinoRedaction.paths).toContain('*.rawPayload');
    expect(pinoRedaction.paths).toContain('*.jobData');
    expect(pinoRedaction.paths).toContain('*.errorBody');
  });

  it('removes OAuth authorization codes and state from Fastify request logs', async () => {
    const lines: string[] = [];
    const logger = pino({ redact: pinoRedaction }, { write: (line) => lines.push(line) });
    const app = Fastify({ loggerInstance: logger });
    await app.inject('/auth/google/callback?code=authorization-code&state=csrf-state');
    await app.close();

    const entry = JSON.parse(lines[0]!) as { req: { method: string; url: string } };
    expect(entry.req).toEqual(expect.objectContaining({ method: 'GET', url: REDACTED_VALUE }));
    expect(lines[0]).not.toContain('authorization-code');
    expect(lines[0]).not.toContain('csrf-state');
  });

  it('redacts nested request, breadcrumb, context, extra, exception, and array fields', () => {
    const event = {
      request: {
        url: 'https://gastto.fly.dev/auth/google/callback?code=authorization-code&state=csrf-state',
        headers: { Authorization: 'Bearer secret' },
        data: { rawMessage: 'expense' },
      },
      breadcrumbs: [{ data: { access_token: 'token' } }],
      contexts: { auth: { OAuth_State: 'state' } },
      extra: { payload: { amount: 12 } },
      exception: { values: [{ data: { providerErrorBody: 'response' } }] },
      tags: { safe: 'yes' },
    } as unknown as ErrorEvent;

    const scrubbed = scrubSentryEvent(event) as unknown as {
      request: { url: string; headers: { Authorization: string }; data: { rawMessage: string } };
      breadcrumbs: Array<{ data: { access_token: string } }>;
      contexts: { auth: { OAuth_State: string } };
      extra: { payload: string };
      exception: { values: Array<{ data: { providerErrorBody: string } }> };
      tags: { safe: string };
    };

    expect(scrubbed.request.headers.Authorization).toBe(REDACTED_VALUE);
    expect(scrubbed.request.url).toBe(REDACTED_VALUE);
    expect(scrubbed.request.data.rawMessage).toBe(REDACTED_VALUE);
    expect(scrubbed.breadcrumbs[0]!.data.access_token).toBe(REDACTED_VALUE);
    expect(scrubbed.contexts.auth.OAuth_State).toBe(REDACTED_VALUE);
    expect(scrubbed.extra.payload).toBe(REDACTED_VALUE);
    expect(scrubbed.exception.values[0]!.data.providerErrorBody).toBe(REDACTED_VALUE);
    expect(scrubbed.tags.safe).toBe('yes');
    expect(event.request?.headers?.Authorization).toBe('Bearer secret');
  });

  it('handles cycles and bounds traversal without throwing', () => {
    const circular: Record<string, unknown> = { token: 'secret' };
    circular.self = circular;

    const scrubbed = scrubSentryEvent({ extra: circular } as ErrorEvent) as unknown as {
      extra: { token: string; self: string };
    };

    expect(scrubbed.extra.token).toBe(REDACTED_VALUE);
    expect(scrubbed.extra.self).toBe('[Circular]');
  });
});

it('removes synthetic secrets from serialized errors and nested log objects', () => {
  const canary = 'CANARY-SECRET-DO-NOT-EMIT';
  const event = scrubSentryEvent({
    exception: {
      values: [{ value: canary, stacktrace: { frames: [{ vars: { token: canary } }] } }],
    },
    breadcrumbs: [{ message: canary }],
    extra: { error: new Error(canary), nested: { refreshToken: canary } },
  } as unknown as ErrorEvent);
  expect(JSON.stringify(event)).not.toContain(canary);
});

it('scrubs actual Pino output including top-level and nested fields', () => {
  const lines: string[] = [];
  const logger = pino(
    { redact: pinoRedaction, hooks: pinoHooks, formatters: { log: scrubLogObject } },
    { write: (line) => lines.push(line) },
  );
  logger.error({
    code: 'SAFE_EVENT',
    token: 'CANARY-TOP',
    nested: { refreshToken: 'CANARY-NESTED' },
    err: new Error('CANARY-ERROR'),
    headers: { 'x-telegram-bot-api-secret-token': 'CANARY-HEADER' },
  });
  expect(lines.join('')).not.toContain('CANARY-');
  expect(lines.join('')).toContain('SAFE_EVENT');
});

it('bounds deep provider objects and survives throwing metadata getters', () => {
  let nested: Record<string, unknown> = { token: 'CANARY-DEEP' };
  for (let depth = 0; depth < 30; depth++) nested = { nested };
  const scrubbed = scrubSentryEvent({ extra: nested } as ErrorEvent);
  expect(JSON.stringify(scrubbed)).not.toContain('CANARY-DEEP');
  expect(JSON.stringify(scrubbed)).toContain('[Truncated]');
  const malformed = Object.defineProperty({}, 'error', {
    enumerable: true,
    get() {
      throw new Error('CANARY-GETTER');
    },
  });
  expect(scrubLogObject(malformed)).toEqual({ code: 'LOG_PAYLOAD_OMITTED' });
  expect(JSON.stringify(scrubSentryEvent({ extra: malformed } as ErrorEvent))).not.toContain(
    'CANARY-',
  );
});
