// LAYER: Application / Tests
// Unit tests for text replies received while an expense is in review.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type { CorrectExpenseUseCase } from './CorrectExpenseUseCase';
import type { ResolveExpenseSummaryActionUseCase } from './ResolveExpenseSummaryActionUseCase';
import type { QueuePendingExpense } from './QueuePendingExpense';
import type { IExpenseQueueRepository } from '../../../domain/ports/repositories';
import { ResolveExpenseReviewReplyUseCase } from './ResolveExpenseReviewReplyUseCase';

function buildPayload(): ExpenseReviewPayload {
  return {
    rawMessage: 'Café 850 ARS',
    extracted: {
      monto: 850,
      moneda: 'ARS',
      categoriaRaw: 'café',
      fechaRaw: '2026-08-01',
      medioPago: null,
      confianzaCategoria: 'alta',
    },
    resolvedDate: '2026-08-01',
    resolvedCategory: 'Comida',
    resolvedCategoryId: null,
    categoryStatus: 'confirmed',
  };
}

describe('ResolveExpenseReviewReplyUseCase', () => {
  const resolveActionExecute = vi.fn();
  const correctExpenseExecute = vi.fn();
  const queuePendingExpenseExecute = vi.fn();
  const countPendingExpenses = vi.fn();
  const useCase = new ResolveExpenseReviewReplyUseCase({
    resolveExpenseSummaryAction: {
      execute: resolveActionExecute,
    } as unknown as ResolveExpenseSummaryActionUseCase,
    correctExpense: { execute: correctExpenseExecute } as unknown as CorrectExpenseUseCase,
    queuePendingExpense: {
      execute: queuePendingExpenseExecute,
    } as unknown as QueuePendingExpense,
    expenseQueueRepository: {
      countByUserId: countPendingExpenses,
    } as unknown as IExpenseQueueRepository,
  });

  const input = () => ({
    userId: 'user-123',
    rawMessage: 'sí',
    payload: buildPayload(),
    chatId: 'chat-123',
    channel: 'telegram' as const,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resolveActionExecute.mockResolvedValue(undefined);
    correctExpenseExecute.mockResolvedValue({ status: 'not_interpretable' });
    queuePendingExpenseExecute.mockResolvedValue({ status: 'queued', pendingCount: 1 });
    countPendingExpenses.mockResolvedValue(0);
  });

  it('delegates a standard confirmation once to the summary action resolver', async () => {
    const request = input();

    await expect(useCase.execute(request)).resolves.toEqual({
      status: 'action_handled',
      action: 'confirm',
    });

    expect(resolveActionExecute).toHaveBeenCalledOnce();
    expect(resolveActionExecute).toHaveBeenCalledWith({
      userId: request.userId,
      action: 'confirm',
      payload: request.payload,
      chatId: request.chatId,
      channel: request.channel,
    });
    expect(correctExpenseExecute).not.toHaveBeenCalled();
  });

  it.each(['bárbaro', 'vale', 'órale', 'ya'])(
    'delegates regional confirmation %s to the existing save action',
    async (rawMessage) => {
      const request = { ...input(), rawMessage };

      await expect(useCase.execute(request)).resolves.toEqual({
        status: 'action_handled',
        action: 'confirm',
      });

      expect(resolveActionExecute).toHaveBeenCalledOnce();
      expect(resolveActionExecute).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'confirm', payload: request.payload }),
      );
      expect(correctExpenseExecute).not.toHaveBeenCalled();
    },
  );

  it('delegates cancellation to the summary action resolver', async () => {
    const request = { ...input(), rawMessage: 'cancelar' };

    await expect(useCase.execute(request)).resolves.toEqual({
      status: 'action_handled',
      action: 'cancel',
    });

    expect(resolveActionExecute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel', cancellationSource: 'text' }),
    );
    expect(correctExpenseExecute).not.toHaveBeenCalled();
  });

  it('delegates a partial correction with a new correction state', async () => {
    const request = { ...input(), rawMessage: 'no, fueron 15' };
    const corrected = { status: 'corrected' as const, payload: request.payload };
    correctExpenseExecute.mockResolvedValue(corrected);

    await expect(useCase.execute(request)).resolves.toEqual(corrected);

    expect(correctExpenseExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: request.userId,
        rawMessage: request.rawMessage,
        channel: request.channel,
        state: ExpenseCorrectionState.create(request.payload),
      }),
    );
    expect(resolveActionExecute).not.toHaveBeenCalled();
  });

  it('preserves the payload and does not mutate state for an unknown reply', async () => {
    const request = { ...input(), rawMessage: 'uh-huh' };
    const payloadBefore = structuredClone(request.payload);

    await expect(useCase.execute(request)).resolves.toEqual({
      status: 'not_interpretable',
      pendingCount: 0,
    });

    expect(correctExpenseExecute).toHaveBeenCalledOnce();
    expect(request.payload).toEqual(payloadBefore);
    expect(resolveActionExecute).not.toHaveBeenCalled();
    expect(queuePendingExpenseExecute).not.toHaveBeenCalled();
  });

  it('queues only a reply interpreted as a genuine new expense', async () => {
    const request = { ...input(), rawMessage: 'Taxi 12 EUR' };
    correctExpenseExecute.mockResolvedValue({ status: 'new_expense' });

    await expect(useCase.execute(request)).resolves.toEqual({
      status: 'expense_queued',
      pendingCount: 1,
    });

    expect(queuePendingExpenseExecute).toHaveBeenCalledWith({
      userId: request.userId,
      rawMessage: request.rawMessage,
      channel: request.channel,
    });
    expect(resolveActionExecute).not.toHaveBeenCalled();
  });

  it('returns a typed full outcome without mutating the active review', async () => {
    const request = { ...input(), rawMessage: 'Taxi 12 EUR' };
    correctExpenseExecute.mockResolvedValue({ status: 'new_expense' });
    queuePendingExpenseExecute.mockResolvedValue({ status: 'full', pendingCount: 2 });

    await expect(useCase.execute(request)).resolves.toEqual({
      status: 'queue_full',
      pendingCount: 2,
    });

    expect(resolveActionExecute).not.toHaveBeenCalled();
  });
});
