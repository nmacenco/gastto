import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import Redis from 'ioredis';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';

function createTestApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  return app;
}

import { RedisSecurityLimiter } from '../../src/infrastructure/redis/RedisSecurityLimiter';
import { securityAdmission } from '../../src/interfaces/http/middleware/securityAdmission';
import { validateTelegramOrigin } from '../../src/interfaces/http/middleware/telegramAuth';

describe('security admission with real Redis (mandatory)', () => {
  let container: StartedTestContainer;
  let redis: Redis;
  beforeAll(async () => {
    container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    redis = new Redis(container.getMappedPort(6379), container.getHost());
    await redis.ping();
  }, 120000);
  afterAll(async () => {
    redis?.disconnect();
    await container?.stop();
  });
  it('shares an atomic budget, ignores forged forwarding headers and expires counters', async () => {
    const effects = vi.fn(() => ({ ok: true }));
    const apps = [createTestApp(), createTestApp()];
    for (const app of apps)
      app.get(
        '/callback',
        {
          onRequest: securityAdmission(
            new RedisSecurityLimiter(redis, 'integration'),
            'oauth',
            2,
            1000,
          ),
        },
        effects,
      );
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          apps[i % 2]!.inject({
            url: '/callback',
            headers: { 'x-forwarded-for': `10.0.0.${i}`, 'fly-client-ip': `10.0.1.${i}` },
          }),
        ),
      );
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(2);
      expect(results.filter((r) => r.statusCode === 429)).toHaveLength(6);
      expect(effects).toHaveBeenCalledTimes(2);
      expect(results.find((r) => r.statusCode === 429)?.headers['retry-after']).toBe('1');
      await new Promise((resolve) => setTimeout(resolve, 1050));
      expect((await apps[0]!.inject('/callback')).statusCode).toBe(200);
    } finally {
      await Promise.all(apps.map((a) => a.close()));
    }
  });
  it('shares budgets for identical IPv4/IPv6 peers and bounds missing-peer fallback', async () => {
    for (const peer of ['192.0.2.1', '2001:db8::1', 'unknown']) {
      const limiter = new RedisSecurityLimiter(redis, `peer-${peer}`);
      await expect(limiter.admit('oauth', peer, 1, 1000)).resolves.toMatchObject({ allowed: true });
      await expect(limiter.admit('oauth', peer, 1, 1000)).resolves.toMatchObject({
        allowed: false,
      });
      await expect(limiter.admit('telegram', peer, 1, 1000)).resolves.toMatchObject({
        allowed: true,
      });
    }
  });
  it('preserves authentication before parsing and never invokes downstream effects on outage', async () => {
    const disconnected = new Redis(container.getMappedPort(6379), container.getHost(), {
      lazyConnect: true,
    });
    const limiter = new RedisSecurityLimiter(disconnected, 'outage');
    const app = createTestApp();
    const effects = vi.fn(() => ({ ok: true }));
    app.post(
      '/webhook',
      {
        onRequest: validateTelegramOrigin('valid', securityAdmission(limiter, 'telegram', 1, 1000)),
      },
      effects,
    );
    app.get('/callback', { onRequest: securityAdmission(limiter, 'oauth', 1, 1000) }, effects);
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/webhook',
            headers: { 'content-type': 'application/json' },
            payload: '{bad',
          })
        ).statusCode,
      ).toBe(403);
      expect((await app.inject('/callback')).statusCode).toBe(503);
      expect(effects).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/webhook',
            headers: { 'x-telegram-bot-api-secret-token': 'valid' },
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      disconnected.disconnect();
      await app.close();
    }
  });
});
