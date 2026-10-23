// LAYER: Infrastructure / Tests
// Unit tests for RedisUserProcessingLock.
// Mocks the ioredis client interface; no real Redis connection is used.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisUserProcessingLock } from './RedisUserProcessingLock';

const mockSet = vi.fn();
const mockEval = vi.fn();

function buildMockRedis(): Redis {
  return {
    set: mockSet,
    eval: mockEval,
  } as unknown as Redis;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RedisUserProcessingLock', () => {
  it('acquire returns a token and sets the key with NX PX', async () => {
    mockSet.mockResolvedValue('OK');
    const lock = new RedisUserProcessingLock(buildMockRedis());

    const result = await lock.acquire('user-123', 5000);

    expect(result).toEqual(expect.any(String));
    expect(mockSet).toHaveBeenCalledWith('process-message:lock:user-123', result, 'PX', 5000, 'NX');
  });

  it('acquire returns null when the key already exists', async () => {
    mockSet.mockResolvedValue(null);
    const lock = new RedisUserProcessingLock(buildMockRedis());

    const result = await lock.acquire('user-123', 5000);

    expect(result).toBeNull();
  });

  it('release runs the atomic delete-only-if-token-matches script', async () => {
    mockEval.mockResolvedValue(1);
    const lock = new RedisUserProcessingLock(buildMockRedis());

    await lock.release('user-123', 'token-abc');

    expect(mockEval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1]) == ARGV[1]'),
      1,
      'process-message:lock:user-123',
      'token-abc',
    );
  });

  it('acquire after release returns a new token', async () => {
    mockSet.mockResolvedValueOnce('OK');
    mockEval.mockResolvedValueOnce(1);
    mockSet.mockResolvedValueOnce('OK');
    const lock = new RedisUserProcessingLock(buildMockRedis());

    const first = await lock.acquire('user-123', 5000);
    await lock.release('user-123', first!);
    const second = await lock.acquire('user-123', 5000);

    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  it('different users have independent locks', async () => {
    mockSet.mockResolvedValueOnce('OK');
    mockSet.mockResolvedValueOnce('OK');
    const lock = new RedisUserProcessingLock(buildMockRedis());

    const a = await lock.acquire('user-a', 5000);
    const b = await lock.acquire('user-b', 5000);

    expect(a).toEqual(expect.any(String));
    expect(b).toEqual(expect.any(String));
    expect(mockSet).toHaveBeenNthCalledWith(1, 'process-message:lock:user-a', a, 'PX', 5000, 'NX');
    expect(mockSet).toHaveBeenNthCalledWith(2, 'process-message:lock:user-b', b, 'PX', 5000, 'NX');
  });
});
