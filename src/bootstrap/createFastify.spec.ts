// LAYER: Bootstrap / Unit Tests
// Tests for the Fastify factory: plugins, compilers and Sentry error handler.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import * as Sentry from '@sentry/node';

import { createFastify } from './createFastify';
import { createLogger } from '../infrastructure/logger';
import type { Env } from '../config/env.schema';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

const baseEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgres://localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379/0',
  MAPPING_CORRECTION_TTL_SECONDS: 1800,
  CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD: 0.6,
  OPENAI_API_KEY: 'sk-test-openai',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  WEBHOOK_BASE_URL: 'https://example.com',
  ENCRYPTION_KEY: 'a'.repeat(64),
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
};

describe('createFastify', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('registers the standard plugin stack', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));

    expect(app.hasPlugin('@fastify/helmet')).toBe(true);
    expect(app.hasPlugin('@fastify/sensible')).toBe(true);
    expect(app.hasPlugin('@fastify/swagger')).toBe(true);
    expect(app.hasPlugin('@fastify/swagger-ui')).toBe(true);
  });

  it('uses the Zod validator and serializer compilers', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));

    app.withTypeProvider<ZodTypeProvider>().get(
      '/test-validation',
      {
        schema: {
          querystring: z.object({ name: z.string().min(1) }),
          response: {
            200: z.object({ name: z.string() }),
          },
        },
      },
      (req) => ({ name: req.query.name }),
    );

    const valid = await app.inject({ method: 'GET', url: '/test-validation?name=Gastto' });
    expect(valid.statusCode).toBe(200);
    expect(JSON.parse(valid.payload)).toEqual({ name: 'Gastto' });

    const invalid = await app.inject({ method: 'GET', url: '/test-validation?name=' });
    expect(invalid.statusCode).toBe(400);
  });

  it('reports unhandled errors to Sentry', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));

    app.get('/boom', () => {
      throw new Error('intentional test error');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
    const capturedError = vi.mocked(Sentry.captureException).mock.calls[0]?.[0] as Error;
    expect(capturedError.message).toBe('intentional test error');
  });
});
