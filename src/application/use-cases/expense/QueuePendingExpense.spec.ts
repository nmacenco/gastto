import { describe, expect, it, vi } from 'vitest';
import { QueuePendingExpense } from './QueuePendingExpense';
import type { IExpenseQueueRepository } from '../../../domain/ports/repositories';

function buildRepository(pendingCount: number): {
  repository: IExpenseQueueRepository;
  enqueue: ReturnType<typeof vi.fn>;
  countByUserId: ReturnType<typeof vi.fn>;
} {
  const enqueue = vi.fn();
  const countByUserId = vi.fn().mockResolvedValue(pendingCount);
  return {
    repository: {
      findByUserId: vi.fn(),
      countByUserId,
      enqueue,
      dequeueFirst: vi.fn(),
      clearByUserId: vi.fn(),
    },
    enqueue,
    countByUserId,
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

  it('stores consecutive messages as raw FIFO entries without hierarchy interpretation', async () => {
    const { repository, enqueue, countByUserId } = buildRepository(0);
    countByUserId.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const useCase = new QueuePendingExpense(repository);

    await useCase.execute({ userId: 'user-1', rawMessage: 'Taxi 12 EUR', channel: 'telegram' });
    await useCase.execute({
      userId: 'user-1',
      rawMessage: 'Cena restaurante 30 EUR',
      channel: 'whatsapp',
    });

    expect(enqueue).toHaveBeenNthCalledWith(1, 'user-1', 'Taxi 12 EUR', 'telegram');
    expect(enqueue).toHaveBeenNthCalledWith(2, 'user-1', 'Cena restaurante 30 EUR', 'whatsapp');
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
