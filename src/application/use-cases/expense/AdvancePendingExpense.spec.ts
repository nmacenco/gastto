import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdvancePendingExpense } from './AdvancePendingExpense';
import type { IExpenseQueueRepository } from '../../../domain/ports/repositories';
import type { RegisterExpenseUseCase } from './RegisterExpense';
import type { GenerateExpenseSummaryUseCase } from './GenerateExpenseSummaryUseCase';
import { expenseCopies } from '../../copies/expense.copies';

const dequeueFirst = vi.fn();
const findByUserId = vi.fn();
const countByUserId = vi.fn();
const interpret = vi.fn();
const sendMessage = vi.fn();
const generateSummary = vi.fn();
const presentSummary = vi.fn();

function buildUseCase() {
  return new AdvancePendingExpense({
    expenseQueueRepository: {
      dequeueFirst,
      findByUserId,
      countByUserId,
    } as unknown as IExpenseQueueRepository,
    registerExpense: { interpret } as unknown as RegisterExpenseUseCase,
    generateExpenseSummary: {
      execute: generateSummary,
    } as unknown as GenerateExpenseSummaryUseCase,
    messagingPort: { sendMessage },
    expenseSummaryPresenterFactory: vi.fn(() => ({
      presentSummary,
      showTimeoutWarning: vi.fn(),
      notifyCancellation: vi.fn(),
      requestHighAmountConfirmation: vi.fn(),
    })),
  });
}

describe('AdvancePendingExpense', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByUserId.mockResolvedValue([
      {
        id: 'queue-1',
        userId: 'user-1',
        position: 1,
        rawMessage: 'Taxi 12 EUR',
        receivedAt: new Date(),
        channel: 'telegram',
      },
    ]);
    countByUserId.mockResolvedValue(1);
    interpret.mockResolvedValue({
      status: 'ready_for_review',
      payload: {
        rawMessage: 'Taxi 12 EUR',
        extracted: { monto: 12, moneda: 'EUR', confianzaCategoria: 'alta' },
        resolvedDate: '2026-08-05',
        resolvedCategory: 'Transporte',
        resolvedCategoryId: null,
        categoryStatus: 'confirmed',
      },
    });
    sendMessage.mockResolvedValue({ status: 'success' });
    generateSummary.mockResolvedValue(undefined);
  });

  it('dequeues the oldest expense, then sends the notice before its review summary', async () => {
    const useCase = buildUseCase();

    await expect(
      useCase.execute({
        userId: 'user-1',
        chatId: 'chat-1',
        channel: 'telegram',
        reason: 'confirmed',
        completedCount: 1,
      }),
    ).resolves.toEqual({ status: 'advanced', pendingCount: 2 });

    expect(interpret).toHaveBeenCalledWith({
      userId: 'user-1',
      rawMessage: 'Taxi 12 EUR',
      channel: 'telegram',
      queueRegisteredCount: 1,
    });
    expect(sendMessage).toHaveBeenCalledWith('chat-1', expenseCopies.expenseQueueNotice(2));
    expect(sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      generateSummary.mock.invocationCallOrder[0]!,
    );
  });

  it('does nothing when there is no pending expense', async () => {
    findByUserId.mockResolvedValue([]);
    const useCase = buildUseCase();

    await expect(
      useCase.execute({
        userId: 'user-1',
        chatId: 'chat-1',
        channel: 'telegram',
        reason: 'cancelled',
        completedCount: 0,
      }),
    ).resolves.toEqual({ status: 'empty' });

    expect(countByUserId).not.toHaveBeenCalled();
    expect(interpret).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
