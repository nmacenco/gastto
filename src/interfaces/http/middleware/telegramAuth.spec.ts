// LAYER: Interfaces / Tests
// Contract tests for the Telegram origin validation middleware.

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { validateTelegramOrigin } from './telegramAuth';

const SECRET = 'my-test-secret';

async function buildApp() {
  const app = Fastify({ logger: false });

  app.post('/webhook/telegram', {
    onRequest: [validateTelegramOrigin(SECRET)],
    handler: async (_req, reply) => {
      return reply.status(200).send({ ok: true });
    },
  });

  return app;
}

describe('validateTelegramOrigin middleware', () => {
  it('returns HTTP 403 when the secret token header is missing', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      payload: { update_id: 1 },
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.payload)).toEqual({ error: 'Forbidden' });
  });

  it('returns HTTP 403 when the secret token header is invalid', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': 'wrong-secret',
      },
      payload: { update_id: 1 },
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.payload)).toEqual({ error: 'Forbidden' });
  });

  it('allows the request to proceed when the secret token header is valid', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': SECRET,
      },
      payload: { update_id: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });
  });

  it('rejects an invalid origin before body validation', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      payload: '{not valid JSON',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.payload)).toEqual({ error: 'Forbidden' });
  });
});
