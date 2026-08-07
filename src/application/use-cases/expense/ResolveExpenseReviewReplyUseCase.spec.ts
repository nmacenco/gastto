// LAYER: Application / Tests
// Unit tests for text replies received while an expense is in review.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type { CorrectExpenseUseCase } from './CorrectExpenseUseCase';
import type { ResolveExpenseSummaryActionUseCase } from './ResolveExpenseSummaryActionUseCase';
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
  const useCase = new ResolveExpenseReviewReplyUseCase({
    resolveExpenseSummaryAction: {
      execute: resolveActionExecute,
    } as unknown as ResolveExpenseSummaryActionUseCase,
    correctExpense: { execute: correctExpenseExecute } as unknown as CorrectExpenseUseCase,
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

    await expect(useCase.execute(request)).resolves.toEqual({ status: 'not_interpretable' });

    expect(correctExpenseExecute).toHaveBeenCalledOnce();
    expect(request.payload).toEqual(payloadBefore);
    expect(resolveActionExecute).not.toHaveBeenCalled();
  });
});
