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

const hierarchyReview = {
  rawMessage: 'Taxi 12 EUR',
  extracted: {
    monto: 12,
    moneda: 'EUR',
    categoriaRaw: 'transporte',
    subcategoriaRaw: 'Taxi',
    fechaRaw: '2026-08-05',
    medioPago: null,
    confianzaCategoria: 'alta',
    confianzaSubcategoria: 'alta',
  },
  resolvedDate: '2026-08-05',
  resolvedCategory: 'Transporte',
  resolvedCategoryId: 'category-transport',
  categoryStatus: 'confirmed',
  resolvedSubcategory: 'Taxi',
  resolvedSubcategoryId: 'subcategory-taxi',
  subcategoryStatus: 'confirmed',
  subcategoryEnabled: true,
} as const;

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
      payload: hierarchyReview,
    });
    sendMessage.mockResolvedValue({ status: 'success' });
    generateSummary.mockResolvedValue(undefined);
    dequeueFirst.mockResolvedValue({ id: 'queue-1' });
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
    expect(interpret).toHaveBeenCalledOnce();
    expect(generateSummary).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', payload: hierarchyReview }),
    );
    expect(dequeueFirst).toHaveBeenCalledWith('user-1', 'queue-1');
  });

  it.each([
    ['interpretation', () => interpret.mockRejectedValue(new Error('interpretation failed'))],
    ['presentation', () => generateSummary.mockRejectedValue(new Error('presentation failed'))],
  ])('retains the FIFO item when %s fails', async (_name, configureFailure) => {
    configureFailure();
    const useCase = buildUseCase();

    await expect(
      useCase.execute({
        userId: 'user-1',
        chatId: 'chat-1',
        channel: 'telegram',
        reason: 'confirmed',
        completedCount: 1,
      }),
    ).rejects.toThrow();

    expect(dequeueFirst).not.toHaveBeenCalled();
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
