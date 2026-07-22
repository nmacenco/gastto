// LAYER: Application / Tests
// Contract tests for IProcessedMessageRepository.
// Verifies a mock implementation satisfies the port interface and returns
// the expected shapes.

import { describe, it, expect, vi } from 'vitest';
import type { IProcessedMessageRepository } from '../../domain/ports/ProcessedMessageRepository';
import { ProcessedMessageKey } from '../../domain/value-objects/ProcessedMessageKey';

function makeKey() {
  return new ProcessedMessageKey({ channel: 'telegram', externalMessageId: 'msg-12345' });
}

describe('IProcessedMessageRepository contract', () => {
  it('accepts an implementation that returns false for exists', async () => {
    const mockExists = vi.fn().mockResolvedValue(false);
    const repo: IProcessedMessageRepository = {
      exists: mockExists,
      markAsProcessed: vi.fn().mockResolvedValue(undefined),
    };

    const result = await repo.exists(makeKey());
    expect(result).toBe(false);
    expect(mockExists).toHaveBeenCalledWith(makeKey());
  });

  it('accepts an implementation that returns true for exists', async () => {
    const repo: IProcessedMessageRepository = {
      exists: vi.fn().mockResolvedValue(true),
      markAsProcessed: vi.fn().mockResolvedValue(undefined),
    };

    const result = await repo.exists(makeKey());
    expect(result).toBe(true);
  });

  it('accepts an implementation that resolves markAsProcessed', async () => {
    const mockMarkAsProcessed = vi.fn().mockResolvedValue(undefined);
    const repo: IProcessedMessageRepository = {
      exists: vi.fn().mockResolvedValue(false),
      markAsProcessed: mockMarkAsProcessed,
    };

    await expect(repo.markAsProcessed(makeKey())).resolves.toBeUndefined();
    expect(mockMarkAsProcessed).toHaveBeenCalledWith(makeKey());
  });

  it('has the correct method signatures', async () => {
    const repo: IProcessedMessageRepository = {
      exists: vi.fn().mockResolvedValue(false),
      markAsProcessed: vi.fn().mockResolvedValue(undefined),
    };

    expect(typeof repo.exists).toBe('function');
    expect(typeof repo.markAsProcessed).toBe('function');
    await expect(repo.exists(makeKey())).resolves.toBe(false);
    await expect(repo.markAsProcessed(makeKey())).resolves.toBeUndefined();
  });
});
