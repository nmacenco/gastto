// LAYER: Infrastructure
// Redis-backed per-user processing lock for the thick worker.
// Uses SET NX PX to acquire and a token + Lua script to release.
// The token guarantees that a job whose lock expired cannot delete
// a newer job's lock for the same user.
// The TTL acts as a safety net; in normal operation the lock
// is released within seconds.

import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import type { IUserProcessingLock } from '../../application/ports/UserProcessingLock';

function lockKey(userId: string): string {
  return `process-message:lock:${userId}`;
}

// Atomic release: delete only if the stored value matches our token.
const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

export class RedisUserProcessingLock implements IUserProcessingLock {
  constructor(private readonly redis: Redis) {}

  async acquire(userId: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(lockKey(userId), token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async release(userId: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, lockKey(userId), token);
  }
}
