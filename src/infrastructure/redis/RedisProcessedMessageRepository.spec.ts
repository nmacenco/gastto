// LAYER: Infrastructure / Tests
// Unit tests for RedisProcessedMessageRepository.
// Mocks the ioredis client interface; no real Redis connection is used.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { RedisProcessedMessageRepository } from './RedisProcessedMessageRepository';
import { ProcessedMessageKey } from '../../domain/value-objects/ProcessedMessageKey';

const mockExists = vi.fn().mockResolvedValue(0);
const mockSetex = vi.fn().mockResolvedValue('OK');
const mockSadd = vi.fn().mockResolvedValue(1);
const mockExpire = vi.fn().mockResolvedValue(1);

function buildMockRedis(): Redis {
  return {
    exists: mockExists,
    setex: mockSetex,
    sadd: mockSadd,
    expire: mockExpire,
  } as unknown as Redis;
}

function buildKey(
  overrides: Partial<{
    channel: 'telegram' | 'whatsapp';
    externalMessageId: string;
    externalIdentityId: string;
  }> = {},
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
  it('uses separate markers for the same message ID in different chats', async () => {
    const repo = new RedisProcessedMessageRepository(buildMockRedis());
    await repo.markAsProcessed(buildKey({ externalIdentityId: 'chat-a' }), 'owner-a');
    await repo.markAsProcessed(buildKey({ externalIdentityId: 'chat-b' }), 'owner-b');
    const markerA = `processed_message:telegram:${createHash('sha256').update('chat-a').digest('hex')}:msg-12345`;
    const markerB = `processed_message:telegram:${createHash('sha256').update('chat-b').digest('hex')}:msg-12345`;
    expect(mockSetex).toHaveBeenCalledWith(markerA, 86_400, '1');
    expect(mockSetex).toHaveBeenCalledWith(markerB, 86_400, '1');
    expect(mockSadd).toHaveBeenCalledWith('processed_message:owner:owner-a', markerA);
    expect(mockSadd).toHaveBeenCalledWith('processed_message:owner:owner-b', markerB);
  });
  it('indexes a processed marker by owner for targeted account cleanup', async () => {
    const repo = new RedisProcessedMessageRepository(buildMockRedis());
    await repo.markAsProcessed(buildKey(), 'owner');
    expect(mockSadd).toHaveBeenCalledWith(
      'processed_message:owner:owner',
      'processed_message:telegram:msg-12345',
    );
    expect(mockExpire).toHaveBeenCalledWith('processed_message:owner:owner', 86_400);
  });
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
