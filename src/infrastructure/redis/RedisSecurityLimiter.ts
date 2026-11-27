import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

const COUNT = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}`;
export type Admission = { allowed: boolean; retryAfter: number };

/** Fixed buckets cap attacker-controlled key cardinality. No forwarding headers are trusted. */
export class RedisSecurityLimiter {
  private pending = 0;
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
  ) {}

  async admit(
    route: 'oauth' | 'telegram',
    peer: string,
    limit: number,
    windowMs: number,
  ): Promise<Admission> {
    if (this.redis.status !== 'ready' || this.pending >= 16) throw new Error('LIMITER_UNAVAILABLE');
    const bucket = createHash('sha256').update(peer).digest().readUInt16BE(0) % 4096;
    const key = `security:${this.namespace}:${route}:${bucket}`;
    this.pending++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = this.redis.eval(COUNT, 1, key, windowMs).finally(() => {
      this.pending--;
    });
    try {
      const result = await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('LIMITER_UNAVAILABLE')), 250);
        }),
      ]);
      if (!Array.isArray(result) || result.length !== 2 || !result.every(Number.isFinite))
        throw new Error('LIMITER_UNAVAILABLE');
      return {
        allowed: Number(result[0]) <= limit,
        retryAfter: Math.max(1, Math.ceil(Number(result[1]) / 1000)),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
