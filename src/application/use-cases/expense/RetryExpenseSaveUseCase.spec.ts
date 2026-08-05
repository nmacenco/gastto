import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryExpenseSaveUseCase } from './RetryExpenseSaveUseCase';
import type { RegisterExpenseUseCase } from './RegisterExpense';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import { expenseCopies } from '../../copies/expense.copies';

const save = vi.fn();
const transition = vi.fn();
const sendMessage = vi.fn();
const createLog = vi.fn();

const retryPayload = {
  expense: {
    rawMessage: 'Café 200 EUR',
    extracted: { monto: 200, moneda: 'EUR' },
    resolvedDate: '2026-08-05',
    resolvedCategory: 'Comida',
    resolvedCategoryId: null,
    categoryStatus: 'confirmed' as const,
  },
  failureCode: 'NETWORK_ERROR' as const,
  firstAttemptAt: '2026-08-05T10:00:00.000Z',
  attemptCount: 1 as const,
};

function buildUseCase() {
  return new RetryExpenseSaveUseCase({
    registerExpense: { save } as unknown as RegisterExpenseUseCase,
    transitionState: { execute: transition } as unknown as TransitionConversationState,
    messagingPort: { sendMessage },
    operationLogRepo: { create: createLog },
  });
}

describe('RetryExpenseSaveUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    save.mockResolvedValue({ sheetName: 'Gastos', rowIndex: 9 });
    transition.mockResolvedValue({});
    sendMessage.mockResolvedValue({ status: 'success' });
    createLog.mockResolvedValue({});
  });

  it('retries the persisted expense once and sends one successful confirmation', async () => {
    await buildUseCase().execute({
      userId: 'user-123',
      chatId: 'chat-123',
      statePayload: retryPayload,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('user-123', retryPayload.expense, '');
    expect(sendMessage).toHaveBeenNthCalledWith(1, 'chat-123', expenseCopies.saving());
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      'chat-123',
      expenseCopies.expenseSavedConfirmation({
        concept: 'Café 200 EUR',
        amount: 200,
        currency: 'EUR',
        sheetName: 'Gastos',
        rowIndex: 9,
      }),
    );
    expect(transition).not.toHaveBeenCalled();
  });

  it('clears retry state and sends manual-copy fallback after the second failure', async () => {
    save.mockRejectedValue(new SpreadsheetError('Still unavailable', { code: 'NETWORK_ERROR' }));

    await buildUseCase().execute({
      userId: 'user-123',
      chatId: 'chat-123',
      statePayload: retryPayload,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(createLog).toHaveBeenCalledWith(
      'user-123',
      'EXPENSE_SAVE_FAILED',
      { failureCode: 'NETWORK_ERROR', attemptCount: 2 },
      'NETWORK_ERROR',
    );
    expect(transition).toHaveBeenCalledWith({ userId: 'user-123', targetState: 'IDLE' });
    expect(sendMessage).toHaveBeenLastCalledWith(
      'chat-123',
      expenseCopies.saveManualCopyFallback({ concept: 'Café 200 EUR', amount: 200, currency: 'EUR' }),
    );
    expect(sendMessage).not.toHaveBeenCalledWith('chat-123', expect.stringContaining('Gasto guardado'));
  });

  it('does not append malformed or expired retry state', async () => {
    await buildUseCase().execute({
      userId: 'user-123',
      chatId: 'chat-123',
      statePayload: { attemptCount: 1 },
      expiresAt: new Date(Date.now() - 1),
    });

    expect(save).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith({ userId: 'user-123', targetState: 'IDLE', payload: null });
    expect(sendMessage).toHaveBeenCalledWith('chat-123', expenseCopies.saveRetryExpired());
  });
});
