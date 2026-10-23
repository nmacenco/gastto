// LAYER: Infrastructure / Tests
// Unit tests for RedisProcessedMessageRepository.
// Mocks the ioredis client interface; no real Redis connection is used.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisProcessedMessageRepository } from './RedisProcessedMessageRepository';
import { ProcessedMessageKey } from '../../domain/value-objects/ProcessedMessageKey';

const mockExists = vi.fn().mockResolvedValue(0);
const mockSetex = vi.fn().mockResolvedValue('OK');

function buildMockRedis(): Redis {
  return {
    exists: mockExists,
    setex: mockSetex,
  } as unknown as Redis;
}

function buildKey(
  overrides: Partial<{ channel: 'telegram' | 'whatsapp'; externalMessageId: string }> = {},
): ProcessedMessageKey {
  return new ProcessedMessageKey({
    channel: 'telegram',
    externalMessageId: 'msg-12345',
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RedisProcessedMessageRepository', () => {
  it('returns true when the key exists', async () => {
    mockExists.mockResolvedValue(1);
    const redis = buildMockRedis();
    const repo = new RedisProcessedMessageRepository(redis);

    const result = await repo.exists(buildKey());

    expect(result).toBe(true);
    expect(mockExists).toHaveBeenCalledWith('processed_message:telegram:msg-12345');
  });

  it('returns false when the key is missing', async () => {
    mockExists.mockResolvedValue(0);
    const redis = buildMockRedis();
    const repo = new RedisProcessedMessageRepository(redis);

    const result = await repo.exists(buildKey());

    expect(result).toBe(false);
    expect(mockExists).toHaveBeenCalledWith('processed_message:telegram:msg-12345');
  });

  it('marks a key as processed with a 24-hour TTL', async () => {
    const redis = buildMockRedis();
    const repo = new RedisProcessedMessageRepository(redis);

    await repo.markAsProcessed(buildKey());

    expect(mockSetex).toHaveBeenCalledWith('processed_message:telegram:msg-12345', 86_400, '1');
  });

  it('uses the whatsapp channel in the key namespace', async () => {
    mockExists.mockResolvedValue(1);
    const redis = buildMockRedis();
    const repo = new RedisProcessedMessageRepository(redis);

    await repo.exists(buildKey({ channel: 'whatsapp', externalMessageId: 'msg-wa-99' }));

    expect(mockExists).toHaveBeenCalledWith('processed_message:whatsapp:msg-wa-99');
  });
});
