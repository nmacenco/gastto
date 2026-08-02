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

  const useCase = new ResolveExpenseSummaryActionUseCase({
    registerExpense,
    transitionState,
    messagingPort,
    cancelExpenseRegistration:
      cancelExpenseRegistration as unknown as CancelExpenseRegistrationUseCase,
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

  it('does not send a successful confirmation when saving fails', async () => {
    const save = vi
      .fn<RegisterExpenseUseCase['save']>()
      .mockRejectedValue(new SpreadsheetError('Network error during row append'));
    const { useCase, sendMessageMock } = buildUseCase({ save });

    await expect(
      useCase.execute({
        userId: 'user-123',
        action: 'confirm',
        payload: buildPayload(),
        chatId: '123456789',
      }),
    ).rejects.toThrow('Network error during row append');

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith('123456789', expenseCopies.saving());
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
