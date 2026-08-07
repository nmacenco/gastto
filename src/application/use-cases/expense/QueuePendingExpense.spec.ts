import { describe, expect, it, vi } from 'vitest';
import { QueuePendingExpense } from './QueuePendingExpense';
import type { IExpenseQueueRepository } from '../../../domain/ports/repositories';

function buildRepository(pendingCount: number): {
  repository: IExpenseQueueRepository;
  enqueue: ReturnType<typeof vi.fn>;
} {
  const enqueue = vi.fn();
  return {
    repository: {
      findByUserId: vi.fn(),
      countByUserId: vi.fn().mockResolvedValue(pendingCount),
      enqueue,
      dequeueFirst: vi.fn(),
      clearByUserId: vi.fn(),
    },
    enqueue,
  };
}

describe('QueuePendingExpense', () => {
  it('enqueues an expense and reports its FIFO position', async () => {
    const { repository, enqueue } = buildRepository(1);
    const useCase = new QueuePendingExpense(repository);

    await expect(
      useCase.execute({ userId: 'user-1', rawMessage: 'Taxi 12 EUR', channel: 'telegram' }),
    ).resolves.toEqual({ status: 'queued', pendingCount: 2 });

    expect(enqueue).toHaveBeenCalledWith('user-1', 'Taxi 12 EUR', 'telegram');
  });

  it('rejects an overflow without enqueueing or touching the active flow', async () => {
    const { repository, enqueue } = buildRepository(2);
    const useCase = new QueuePendingExpense(repository);

    await expect(
      useCase.execute({ userId: 'user-1', rawMessage: 'Helado 5 EUR', channel: 'whatsapp' }),
    ).resolves.toEqual({ status: 'full', pendingCount: 2 });

    expect(enqueue).not.toHaveBeenCalled();
  });
});
