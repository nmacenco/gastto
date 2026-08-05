// LAYER: Application / Tests
// Unit tests for ResolveExpenseSummaryActionUseCase.
// Mocks the register-expense use case, transition use case, and messaging port
// so only the action-resolution logic is exercised.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResolveExpenseSummaryActionUseCase } from './ResolveExpenseSummaryActionUseCase';
import type { CancelExpenseRegistrationUseCase } from './CancelExpenseRegistrationUseCase';
import type { RegisterExpenseUseCase } from './RegisterExpense';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { expenseCopies } from '../../copies/expense.copies';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import type { IOperationLogRepository } from '../../../domain/ports/repositories';

function buildPayload(overrides: Partial<ExpenseReviewPayload> = {}): ExpenseReviewPayload {
  return {
    rawMessage: 'Cafe 850 ARS',
    extracted: {
      monto: 850,
      moneda: 'ARS',
      categoriaRaw: 'café',
      fechaRaw: '2026-07-25',
      medioPago: null,
      confianzaCategoria: 'alta',
    },
    resolvedDate: '2026-07-25',
    resolvedCategory: 'Comida',
    resolvedCategoryId: null,
    categoryStatus: 'confirmed',
    ...overrides,
  };
}

function buildUseCase(
  overrides: {
    save?: ReturnType<typeof vi.fn<RegisterExpenseUseCase['save']>>;
    transition?: ReturnType<typeof vi.fn<TransitionConversationState['execute']>>;
    sendMessage?: ReturnType<typeof vi.fn<MessagingOutputPort['sendMessage']>>;
    cancelExpenseRegistration?: ReturnType<typeof vi.fn>;
    operationLogCreate?: ReturnType<typeof vi.fn<IOperationLogRepository['create']>>;
  } = {},
) {
  const saveMock: ReturnType<typeof vi.fn<RegisterExpenseUseCase['save']>> =
    overrides.save ??
    vi.fn<RegisterExpenseUseCase['save']>().mockResolvedValue({ sheetName: 'Hoja 1', rowIndex: 2 });
  const transitionMock: ReturnType<typeof vi.fn<TransitionConversationState['execute']>> =
    overrides.transition ??
    vi.fn<TransitionConversationState['execute']>().mockResolvedValue({
      userId: 'user-123',
      currentState: 'EXPENSE_CORRECTING',
      statePayload: null,
      expiresAt: null,
      enteredAt: new Date(),
      updatedAt: new Date(),
    });
  const sendMessageMock: ReturnType<typeof vi.fn<MessagingOutputPort['sendMessage']>> =
    overrides.sendMessage ??
    vi.fn<MessagingOutputPort['sendMessage']>().mockResolvedValue({ status: 'success' });

  const registerExpense = { save: saveMock } as unknown as RegisterExpenseUseCase;
  const transitionState = { execute: transitionMock } as unknown as TransitionConversationState;
  const messagingPort = { sendMessage: sendMessageMock };
  const cancelExpenseRegistration = {
    execute:
      overrides.cancelExpenseRegistration ?? vi.fn().mockResolvedValue({ status: 'cancelled' }),
  };
  const operationLogCreate =
    overrides.operationLogCreate ??
    vi.fn<IOperationLogRepository['create']>().mockResolvedValue({} as never);

  const useCase = new ResolveExpenseSummaryActionUseCase({
    registerExpense,
    transitionState,
    messagingPort,
    cancelExpenseRegistration:
      cancelExpenseRegistration as unknown as CancelExpenseRegistrationUseCase,
    operationLogRepo: { create: operationLogCreate },
  });

  return {
    useCase,
    registerExpense,
    transitionState,
    messagingPort,
    saveMock,
    transitionMock,
    sendMessageMock,
    cancelExpenseRegistration,
    operationLogCreate,
  };
}

describe('ResolveExpenseSummaryActionUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirm sends saving message, saves the expense, and sends confirmation', async () => {
    const { useCase, saveMock, sendMessageMock } = buildUseCase();
    const payload = buildPayload();

    await useCase.execute({
      userId: 'user-123',
      action: 'confirm',
      payload,
      chatId: '123456789',
    });

    expect(sendMessageMock).toHaveBeenNthCalledWith(1, '123456789', expenseCopies.saving());
    expect(saveMock).toHaveBeenCalledWith('user-123', payload, '');
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      2,
      '123456789',
      expenseCopies.expenseSavedConfirmation({
        concept: 'Cafe 850 ARS',
        amount: 850,
        currency: 'ARS',
        sheetName: 'Hoja 1',
        rowIndex: 2,
      }),
    );
  });

  it('confirms the destination sheet without a row when the save result has no row', async () => {
    const save = vi.fn<RegisterExpenseUseCase['save']>().mockResolvedValue({ sheetName: 'Gastos' });
    const { useCase, sendMessageMock } = buildUseCase({ save });

    await useCase.execute({
      userId: 'user-123',
      action: 'confirm',
      payload: buildPayload(),
      chatId: '123456789',
    });

    expect(sendMessageMock).toHaveBeenLastCalledWith(
      '123456789',
      expenseCopies.expenseSavedConfirmation({
        concept: 'Cafe 850 ARS',
        amount: 850,
        currency: 'ARS',
        sheetName: 'Gastos',
      }),
    );
  });

  it('persists a retry state and sends recovery copy for a retryable save failure', async () => {
    const save = vi.fn<RegisterExpenseUseCase['save']>().mockRejectedValue(
      new SpreadsheetError('Network error during row append', {
        code: 'NETWORK_ERROR',
        retryable: true,
      }),
    );
    const { useCase, sendMessageMock, transitionMock, operationLogCreate } = buildUseCase({ save });

    await useCase.execute({
      userId: 'user-123',
      action: 'confirm',
      payload: buildPayload(),
      chatId: '123456789',
    });

    const savingTransition = transitionMock.mock.calls[0]?.[0];
    const retryTransition = transitionMock.mock.calls[1]?.[0];
    if (!savingTransition || !retryTransition) throw new Error('Expected both save transitions');

    expect(savingTransition).toMatchObject({
      userId: 'user-123',
      targetState: 'EXPENSE_SAVING',
      payload: { rawMessage: 'Cafe 850 ARS' },
    });
    expect(retryTransition.userId).toBe('user-123');
    expect(retryTransition.targetState).toBe('EXPENSE_SAVING_RETRY');
    expect(retryTransition.expiresAt).toBeInstanceOf(Date);
    expect(retryTransition.payload).toMatchObject({
      failureCode: 'NETWORK_ERROR',
      attemptCount: 1,
      expense: { rawMessage: 'Cafe 850 ARS' },
    });
    expect(operationLogCreate).toHaveBeenCalledWith(
      'user-123',
      'EXPENSE_SAVE_FAILED',
      { failureCode: 'NETWORK_ERROR' },
      'NETWORK_ERROR',
    );
    expect(sendMessageMock).toHaveBeenLastCalledWith(
      '123456789',
      expenseCopies.saveNetworkFailure(),
    );
    expect(sendMessageMock).not.toHaveBeenCalledWith(
      '123456789',
      expect.stringContaining('Gasto guardado'),
    );
  });

  it('returns to IDLE and sends authorization recovery copy for an auth failure', async () => {
    const save = vi
      .fn<RegisterExpenseUseCase['save']>()
      .mockRejectedValue(new SpreadsheetError('Access token expired', { code: 'AUTH_ERROR' }));
    const { useCase, sendMessageMock, transitionMock } = buildUseCase({ save });

    await useCase.execute({
      userId: 'user-123',
      action: 'confirm',
      payload: buildPayload(),
      chatId: '123456789',
    });

    expect(transitionMock).toHaveBeenLastCalledWith({ userId: 'user-123', targetState: 'IDLE' });
    expect(sendMessageMock).toHaveBeenLastCalledWith(
      '123456789',
      expenseCopies.saveAuthorizationFailure(),
    );
    expect(sendMessageMock).not.toHaveBeenCalledWith(
      '123456789',
      expect.stringContaining('Gasto guardado'),
    );
  });

  it('correct transitions to EXPENSE_CORRECTING and asks which field to change', async () => {
    const { useCase, transitionMock, sendMessageMock } = buildUseCase();
    const payload = buildPayload();

    await useCase.execute({
      userId: 'user-123',
      action: 'correct',
      payload,
      chatId: '123456789',
    });

    expect(transitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        targetState: 'EXPENSE_CORRECTING',
      }),
    );
    const transitionCall = transitionMock.mock.calls[0];
    expect(transitionCall?.[0].payload).toEqual(
      expect.objectContaining({
        _type: 'ExpenseCorrectionState',
        payload,
        correctionCycles: 0,
        pendingHighAmountConfirmation: false,
      }),
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      '123456789',
      expenseCopies.expenseCorrectionPrompt(),
    );
  });

  it('cancel transitions to IDLE and sends the cancellation copy', async () => {
    const { useCase, transitionMock, sendMessageMock, cancelExpenseRegistration } = buildUseCase();

    await useCase.execute({
      userId: 'user-123',
      action: 'cancel',
      payload: buildPayload(),
      chatId: '123456789',
    });

    expect(transitionMock).not.toHaveBeenCalled();
    expect(cancelExpenseRegistration.execute).toHaveBeenCalledWith({
      userId: 'user-123',
      chatId: '123456789',
      currentState: 'EXPENSE_REVIEW',
      source: 'callback',
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});
