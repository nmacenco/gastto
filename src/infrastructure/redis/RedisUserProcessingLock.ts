// LAYER: Infrastructure
// Redis-backed per-user processing lock for the thick worker.
// Uses SET NX PX to acquire and DEL to release.
// The TTL acts as a safety net; in normal operation the lock
// is released within seconds.

import type { Redis } from 'ioredis';
import type { IUserProcessingLock } from '../../application/ports/UserProcessingLock';

function lockKey(userId: string): string {
  return `process-message:lock:${userId}`;
}

export class RedisUserProcessingLock implements IUserProcessingLock {
  constructor(private readonly redis: Redis) {}

  async acquire(userId: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(lockKey(userId), '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async release(userId: string): Promise<void> {
    await this.redis.del(lockKey(userId));
  }
}
