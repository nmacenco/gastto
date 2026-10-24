import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { SettingsOAuthCleanup } from './SettingsOAuthCleanup';

describe('SettingsOAuthCleanup', () => {
  it('attempts both resource removals and reports failures without undoing a committed flow', async () => {
    const del = vi.fn().mockRejectedValue(new Error('redis unavailable'));
    const remove = vi.fn().mockRejectedValue(new Error('queue unavailable'));
    const error = vi.fn();
    const cleanup = new SettingsOAuthCleanup(
      { del } as unknown as Redis,
      { remove } as unknown as Queue,
      { error } as unknown as Logger,
    );
    await expect(
      cleanup.execute({ state: 'old-nonce', reminderJobId: 'old-job' }),
    ).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith('oauth:state:old-nonce');
    expect(remove).toHaveBeenCalledWith('old-job');
    expect(error).toHaveBeenCalledTimes(2);
  });
});
