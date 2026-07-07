// LAYER: Infrastructure / Tests
// Unit tests for RedisUserProcessingLock.
// Mocks the ioredis client interface; no real Redis connection is used.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisUserProcessingLock } from './RedisUserProcessingLock';

const mockSet = vi.fn();
const mockDel = vi.fn();

function buildMockRedis(): Redis {
  return {
    set: mockSet,
    del: mockDel,
  } as unknown as Redis;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RedisUserProcessingLock', () => {
  it('acquire returns true and sets the key with NX PX', async () => {
    mockSet.mockResolvedValue('OK');
    const lock = new RedisUserProcessingLock(buildMockRedis());

    const result = await lock.acquire('user-123', 5000);

    expect(result).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(
      'process-message:lock:user-123',
      '1',
      'PX',
      5000,
      'NX',
    );
  });

  it('acquire returns false when the key already exists', async () => {
    mockSet.mockResolvedValue(null);
    const lock = new RedisUserProcessingLock(buildMockRedis());

    const result = await lock.acquire('user-123', 5000);

    expect(result).toBe(false);
  });

  it('release deletes the key', async () => {
    mockDel.mockResolvedValue(1);
    const lock = new RedisUserProcessingLock(buildMockRedis());

    await lock.release('user-123');

    expect(mockDel).toHaveBeenCalledWith('process-message:lock:user-123');
  });

  it('acquire after release returns true again', async () => {
    mockSet.mockResolvedValueOnce('OK');
    mockDel.mockResolvedValueOnce(1);
    mockSet.mockResolvedValueOnce('OK');
    const lock = new RedisUserProcessingLock(buildMockRedis());

    const first = await lock.acquire('user-123', 5000);
    await lock.release('user-123');
    const second = await lock.acquire('user-123', 5000);

    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  it('different users have independent locks', async () => {
    mockSet.mockResolvedValueOnce('OK');
    mockSet.mockResolvedValueOnce('OK');
    const lock = new RedisUserProcessingLock(buildMockRedis());

    const a = await lock.acquire('user-a', 5000);
    const b = await lock.acquire('user-b', 5000);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(mockSet).toHaveBeenNthCalledWith(
      1,
      'process-message:lock:user-a',
      '1',
      'PX',
      5000,
      'NX',
    );
    expect(mockSet).toHaveBeenNthCalledWith(
      2,
      'process-message:lock:user-b',
      '1',
      'PX',
      5000,
      'NX',
    );
  });
});
