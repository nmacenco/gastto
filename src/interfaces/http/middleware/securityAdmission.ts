import type { onRequestAsyncHookHandler } from 'fastify';
import type { RedisSecurityLimiter } from '../../../infrastructure/redis/RedisSecurityLimiter';

export function securityAdmission(
  limiter: RedisSecurityLimiter,
  route: 'oauth' | 'telegram',
  limit: number,
  windowMs: number,
): onRequestAsyncHookHandler {
  let lastEvent = 0;
  return async (req, reply) => {
    const log = (code: string) => {
      // Bound repetitive event volume; counters in Redis still count every attempt.
      if (Date.now() - lastEvent >= 10_000) {
        req.log.warn({ msg: 'HTTP security admission', endpoint: route, code });
        lastEvent = Date.now();
      }
    };
    try {
      const result = await limiter.admit(
        route,
        req.raw.socket.remoteAddress ?? 'unknown',
        limit,
        windowMs,
      );
      if (!result.allowed) {
        log('HTTP_RATE_LIMITED');
        await reply
          .header('retry-after', String(result.retryAfter))
          .header('cache-control', 'no-store')
          .code(429)
          .send({ error: 'Too Many Requests' });
      }
    } catch {
      log('LIMITER_UNAVAILABLE');
      if (route === 'oauth')
        await reply
          .header('retry-after', '1')
          .header('cache-control', 'no-store')
          .code(503)
          .send({ error: 'Service Unavailable' });
    }
  };
}
