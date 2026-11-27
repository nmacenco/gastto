import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisSecurityLimiter } from './RedisSecurityLimiter';

describe('RedisSecurityLimiter', () => {
  it('does not queue requests when disconnected', async () => {
    const evalCommand = vi.fn();
    const limiter = new RedisSecurityLimiter(
      { status: 'reconnecting', eval: evalCommand } as unknown as Redis,
      'test',
    );
    await expect(limiter.admit('oauth', 'peer', 60, 60000)).rejects.toThrow('LIMITER_UNAVAILABLE');
    expect(evalCommand).not.toHaveBeenCalled();
  });
  it('bounds latency and outstanding commands even when Redis never responds', async () => {
    vi.useFakeTimers();
    try {
      const evalCommand = vi.fn(() => new Promise(() => {}));
      const limiter = new RedisSecurityLimiter(
        { status: 'ready', eval: evalCommand } as unknown as Redis,
        'test',
      );
      const results = Promise.allSettled(
        Array.from({ length: 20 }, () => limiter.admit('oauth', 'peer', 60, 60000)),
      );
      await vi.advanceTimersByTimeAsync(251);
      expect((await results).every((result) => result.status === 'rejected')).toBe(true);
      expect(evalCommand).toHaveBeenCalledTimes(16);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('recovers admission after the existing connection becomes ready', async () => {
  const connection = { status: 'reconnecting', eval: vi.fn().mockResolvedValue([1, 60000]) };
  const limiter = new RedisSecurityLimiter(connection as unknown as Redis, 'test');
  await expect(limiter.admit('oauth', '::1', 60, 60000)).rejects.toThrow('LIMITER_UNAVAILABLE');
  connection.status = 'ready';
  await expect(limiter.admit('oauth', '::1', 60, 60000)).resolves.toMatchObject({ allowed: true });
  expect(connection.eval).toHaveBeenCalledOnce();
});
