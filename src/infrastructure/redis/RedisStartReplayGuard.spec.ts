import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisStartReplayGuard } from './RedisStartReplayGuard';

describe('RedisStartReplayGuard', () => {
  it('uses a bounded opaque marker and treats duplicate start messages as replay', async () => {
    const set = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const del = vi.fn().mockResolvedValue(1);
    const guard = new RedisStartReplayGuard({ set, del } as unknown as Redis, 'runtime-test-key');
    expect(await guard.claim('chat-owner', 'msg-1')).toBe(true);
    expect(await guard.claim('chat-owner', 'msg-1')).toBe(false);
    const firstKey = set.mock.calls[0]?.[0] as string;
    expect(firstKey).not.toContain('chat-owner');
    expect(firstKey).not.toContain('msg-1');
    expect(set).toHaveBeenCalledWith(firstKey, '1', 'EX', 172_800, 'NX');
    await guard.release('chat-owner', 'msg-1');
    expect(del).toHaveBeenCalledWith(firstKey);
  });
});
