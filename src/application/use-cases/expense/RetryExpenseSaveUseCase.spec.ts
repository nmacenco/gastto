import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryExpenseSaveUseCase } from './RetryExpenseSaveUseCase';
import type { RegisterExpenseUseCase } from './RegisterExpense';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import { expenseCopies } from '../../copies/expense.copies';
import type { AdvancePendingExpense } from './AdvancePendingExpense';

const save = vi.fn();
const transition = vi.fn();
const sendMessage = vi.fn();
const createLog = vi.fn();
const advance = vi.fn();

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
    paymentMethodSelection: {
      status: 'legacy' as const,
      sourceConfigId: null,
      paymentMethodId: null,
      canonicalName: null,
      unresolvedRaw: null,
    },
  },
  failureCode: 'NETWORK_ERROR' as const,
  firstAttemptAt: '2026-08-05T10:00:00.000Z',
  attemptCount: 1 as const,
  actionBinding: {
    operationId: 'abcdefghijklmnopqrstuv',
    revision: 1,
    presentedAt: '2026-09-12T10:00:00.000Z',
  },
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

function buildUseCase(
  statePayload: Record<string, unknown> = retryPayload,
  expiresAt = new Date(Date.now() + 60_000),
) {
  return new RetryExpenseSaveUseCase({
    registerExpense: { save } as unknown as RegisterExpenseUseCase,
    transitionState: {
      execute: transition,
      currentState: vi.fn().mockReturnValue({
        revision: '0',
        currentState: 'EXPENSE_SAVING_RETRY',
        statePayload,
        expiresAt,
      }),
      finalizeClaim: transition,
    } as unknown as TransitionConversationState,
    messagingPort: { sendMessage },
    operationLogRepo: { create: createLog },
    advancePendingExpense: { execute: advance } as unknown as AdvancePendingExpense,
  });
}

const authorization = {
  receivedAt: '2026-09-13T10:00:00.000Z',
  sourceMessageId: 'message-1',
};

describe('RetryExpenseSaveUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    save.mockResolvedValue({ sheetName: 'Gastos', rowIndex: 9 });
    transition.mockResolvedValue({});
    sendMessage.mockResolvedValue({ status: 'success' });
    createLog.mockResolvedValue({});
    advance.mockResolvedValue({ status: 'empty' });
  });

  it('advances the queued expense after one confirmed retry with saved undo context', async () => {
    const queuedRetry = {
      ...retryPayload,
      expense: { ...retryPayload.expense, queueRegisteredCount: 1 },
    };
    save.mockResolvedValue({ sheetName: 'Gastos', rowIndex: 9, expenseId: 'saved-a' });
    advance.mockResolvedValue({ status: 'advanced', pendingCount: 1 });

    await buildUseCase(queuedRetry).execute({
      userId: 'user-123',
      chatId: 'chat-123',
      channel: 'whatsapp',
      authorization,
    });

    expect(save).toHaveBeenCalledOnce();
    expect(advance).toHaveBeenCalledOnce();
    expect(advance).toHaveBeenCalledWith({
      userId: 'user-123',
      chatId: 'chat-123',
      channel: 'whatsapp',
      reason: 'confirmed',
      completedCount: 2,
      immediateUndoExpenseId: 'saved-a',
    });
    expect(sendMessage.mock.invocationCallOrder[1]!).toBeLessThan(
      advance.mock.invocationCallOrder[0]!,
    );
    expect(createLog).not.toHaveBeenCalled();
  });

  it('closes a completed batch only after finding the queue empty', async () => {
    const lastRetry = {
      ...retryPayload,
      expense: { ...retryPayload.expense, queueRegisteredCount: 2 },
    };
    await buildUseCase(lastRetry).execute({
      userId: 'user-123',
      chatId: 'chat-123',
      channel: 'telegram',
      authorization,
    });
    expect(advance).toHaveBeenCalledWith(
      expect.objectContaining({
        completedCount: 3,
        reason: 'confirmed',
        channel: 'telegram',
      }),
    );
    expect(sendMessage).toHaveBeenLastCalledWith(
      'chat-123',
      expenseCopies.expenseQueueClosingSummary(3),
    );
    expect(advance.mock.invocationCallOrder[0]!).toBeLessThan(
      sendMessage.mock.invocationCallOrder[2]!,
    );
    expect(save).toHaveBeenCalledOnce();
  });

  it('does not classify a failed success message as another append failure', async () => {
    sendMessage
      .mockResolvedValueOnce({ status: 'success' })
      .mockRejectedValueOnce(new Error('delivery failed'));
    await expect(
      buildUseCase().execute({
        userId: 'user-123',
        chatId: 'chat-123',
        channel: 'telegram',
        authorization,
      }),
    ).rejects.toThrow('delivery failed');
    expect(save).toHaveBeenCalledOnce();
    expect(advance).not.toHaveBeenCalled();
    expect(createLog).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalledWith('chat-123', expect.stringContaining('copiar'));
  });

  it('does not classify a failed next review as another append failure', async () => {
    advance.mockRejectedValue(new Error('next review failed'));
    await expect(
      buildUseCase().execute({
        userId: 'user-123',
        chatId: 'chat-123',
        channel: 'telegram',
        authorization,
      }),
    ).rejects.toThrow('next review failed');
    expect(save).toHaveBeenCalledOnce();
    expect(advance).toHaveBeenCalledOnce();
    expect(createLog).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('retries the persisted expense once and sends one successful confirmation', async () => {
    await buildUseCase().execute({
      userId: 'user-123',
      chatId: 'chat-123',
      channel: 'telegram',
      authorization,
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
    await buildUseCase(statePayload).execute({
      userId: 'user-123',
      chatId: 'chat-123',
      channel: 'telegram',
      authorization,
    });

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('user-123', statePayload.expense, '', expect.any(String));
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('replays the confirmed payment identity and name after an append failure', async () => {
    const selectedPayment = {
      ...validNoChildRetryPayload,
      expense: {
        ...validNoChildRetryPayload.expense,
        extracted: { ...validNoChildRetryPayload.expense.extracted, medioPago: 'Visa' },
        paymentMethodSelection: {
          status: 'matched' as const,
          sourceConfigId: 'config-1',
          paymentMethodId: 'payment-visa',
          canonicalName: 'Visa',
          unresolvedRaw: null,
        },
      },
    };
    await buildUseCase(selectedPayment).execute({
      userId: 'user-123',
      chatId: 'chat-123',
      channel: 'telegram',
      authorization,
    });

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      'user-123',
      selectedPayment.expense,
      'config-1',
      expect.any(String),
    );
  });

  it('clears retry state and sends manual-copy fallback after the second failure', async () => {
    save.mockRejectedValue(new SpreadsheetError('Still unavailable', { code: 'NETWORK_ERROR' }));

    await buildUseCase().execute({
      userId: 'user-123',
      chatId: 'chat-123',
      channel: 'telegram',
      authorization,
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

    await buildUseCase(retryPayload, expiresAt).execute({
      userId: 'user-123',
      chatId: 'chat-123',
      channel: 'telegram',
      authorization,
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

  it('does not append malformed retry state', async () => {
    await expect(
      buildUseCase({ attemptCount: 1 }).execute({
        userId: 'user-123',
        chatId: 'chat-123',
        channel: 'telegram',
        authorization,
      }),
    ).resolves.toEqual({ status: 'invalid' });

    expect(save).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rejects retry at expiry without consuming or appending', async () => {
    await expect(
      buildUseCase(retryPayload, new Date(Date.now() - 1)).execute({
        userId: 'user-123',
        chatId: 'chat-123',
        channel: 'telegram',
        authorization,
      }),
    ).resolves.toEqual({ status: 'expired' });
    expect(save).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('rejects an unresolved or already-consumed retry claim', async () => {
    const claimed = {
      ...retryPayload,
      executionClaim: {
        claimId: 'claim-1',
        kind: 'retry',
        operationId: retryPayload.actionBinding.operationId,
        sourceMessageId: 'message-1',
        status: 'in_flight',
        target: { expense: retryPayload.expense, attemptCount: 2 },
      },
    };
    await expect(
      buildUseCase(claimed).execute({
        userId: 'user-123',
        chatId: 'chat-123',
        channel: 'telegram',
        authorization,
      }),
    ).resolves.toEqual({ status: 'operation_in_progress' });
    expect(save).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('normalizes a valid legacy review before replaying it without NLP', async () => {
    await buildUseCase().execute({
      userId: 'user-123',
      chatId: 'chat-123',
      channel: 'telegram',
      authorization,
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
