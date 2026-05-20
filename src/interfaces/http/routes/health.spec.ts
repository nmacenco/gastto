// LAYER: Interfaces / Tests
// Minimal contract test for the health-check endpoint.

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.get('/health', () => ({
    status: 'ok',
    ts: new Date().toISOString(),
  }));
  return app;
}

describe('GET /health', () => {
  it('returns HTTP 200 with status ok', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { status: string; ts: string };
    expect(body.status).toBe('ok');
    expect(body.ts).toBeDefined();
  });
});
