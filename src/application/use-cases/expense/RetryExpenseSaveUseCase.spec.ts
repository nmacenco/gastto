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
    extracted: {
      monto: 200,
      moneda: 'EUR',
      categoriaRaw: 'café',
      fechaRaw: '2026-08-05',
      medioPago: null,
      confianzaCategoria: 'alta',
    },
    resolvedDate: '2026-08-05',
    resolvedCategory: 'Comida',
    resolvedCategoryId: null,
    categoryStatus: 'confirmed' as const,
  },
  failureCode: 'NETWORK_ERROR' as const,
  firstAttemptAt: '2026-08-05T10:00:00.000Z',
  attemptCount: 1 as const,
};

const selectedChildRetryPayload = {
  ...retryPayload,
  expense: {
    ...retryPayload.expense,
    extracted: {
      ...retryPayload.expense.extracted,
      subcategoriaRaw: 'Restaurante',
      confianzaSubcategoria: 'alta' as const,
    },
    resolvedCategoryId: 'category-food',
    resolvedSubcategory: 'Restaurante',
    resolvedSubcategoryId: 'subcategory-restaurant',
    subcategoryStatus: 'confirmed' as const,
    subcategoryEnabled: true,
  },
};

const validNoChildRetryPayload = {
  ...retryPayload,
  expense: {
    ...retryPayload.expense,
    extracted: {
      ...retryPayload.expense.extracted,
      subcategoriaRaw: null,
      confianzaSubcategoria: 'nula' as const,
    },
    resolvedCategoryId: 'category-food',
    resolvedSubcategory: null,
    resolvedSubcategoryId: null,
    subcategoryStatus: 'none' as const,
    subcategoryEnabled: true,
  },
};

function buildUseCase() {
  return new RetryExpenseSaveUseCase({
    registerExpense: { save } as unknown as RegisterExpenseUseCase,
    transitionState: {
      execute: transition,
      currentState: vi.fn().mockReturnValue({ revision: '0' }),
      finalizeClaim: transition,
    } as unknown as TransitionConversationState,
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
    expect(save).toHaveBeenCalledWith('user-123', normalizedRetryExpense(), '', expect.any(String));
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
    expect(transition).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['selected child', selectedChildRetryPayload],
    ['valid no-child selection', validNoChildRetryPayload],
  ])('replays the complete %s review exactly once', async (_name, statePayload) => {
    await buildUseCase().execute({
      userId: 'user-123',
      chatId: 'chat-123',
      statePayload,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('user-123', statePayload.expense, '', expect.any(String));
    expect(sendMessage).toHaveBeenCalledTimes(2);
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
    const firstTransitionInput: unknown = transition.mock.calls[0]?.[0];
    const claimIdValue =
      typeof firstTransitionInput === 'object' &&
      firstTransitionInput !== null &&
      'claimId' in firstTransitionInput
        ? firstTransitionInput.claimId
        : undefined;
    expect(typeof claimIdValue).toBe('string');
    const claimId = typeof claimIdValue === 'string' ? claimIdValue : '';
    expect(transition).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'IDLE',
      claimId,
    });
    expect(sendMessage).toHaveBeenLastCalledWith(
      'chat-123',
      expenseCopies.saveManualCopyFallback({
        concept: 'Café 200 EUR',
        amount: 200,
        currency: 'EUR',
      }),
    );
    expect(sendMessage).not.toHaveBeenCalledWith(
      'chat-123',
      expect.stringContaining('Gasto guardado'),
    );
    expect(save).toHaveBeenCalledOnce();
    expect(transition).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('keeps an unresolved retry claim when the second append outcome is unknown', async () => {
    save.mockRejectedValue(
      new SpreadsheetError('Connection closed after append request', {
        code: 'NETWORK_ERROR',
        retryable: true,
        outcomeUnknown: true,
      }),
    );
    const expiresAt = new Date(Date.now() + 60_000);

    await buildUseCase().execute({
      userId: 'user-123',
      chatId: 'chat-123',
      statePayload: retryPayload,
      expiresAt,
    });

    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition.mock.calls[1]?.[0]).toMatchObject({
      userId: 'user-123',
      targetState: 'EXPENSE_SAVING_RETRY',
      expiresAt,
      payload: { executionClaim: { status: 'outcome_unknown' } },
    });
    expect(sendMessage).toHaveBeenLastCalledWith(
      'chat-123',
      expenseCopies.financialOutcomeUnknown(),
    );
  });

  it('does not append malformed or expired retry state', async () => {
    await buildUseCase().execute({
      userId: 'user-123',
      chatId: 'chat-123',
      statePayload: { attemptCount: 1 },
      expiresAt: new Date(Date.now() - 1),
    });

    expect(save).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'IDLE',
      payload: null,
    });
    expect(sendMessage).toHaveBeenCalledWith('chat-123', expenseCopies.saveRetryExpired());
  });

  it('normalizes a valid legacy review before replaying it without NLP', async () => {
    await buildUseCase().execute({
      userId: 'user-123',
      chatId: 'chat-123',
      statePayload: retryPayload,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(save).toHaveBeenCalledWith('user-123', normalizedRetryExpense(), '', expect.any(String));
  });
});

function normalizedRetryExpense() {
  return {
    ...retryPayload.expense,
    extracted: {
      ...retryPayload.expense.extracted,
      subcategoriaRaw: null,
      confianzaSubcategoria: 'nula' as const,
    },
    resolvedSubcategory: null,
    resolvedSubcategoryId: null,
    subcategoryStatus: 'none' as const,
    subcategoryEnabled: false,
  };
}
