// LAYER: Application / Tests
// Unit tests for ResolveExpenseSummaryActionUseCase.
// Mocks the register-expense use case, transition use case, and messaging port
// so only the action-resolution logic is exercised.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResolveExpenseSummaryActionUseCase } from './ResolveExpenseSummaryActionUseCase';
import type { RegisterExpenseUseCase } from './RegisterExpense';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { expenseCopies } from '../../copies/expense.copies';

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

  const useCase = new ResolveExpenseSummaryActionUseCase({
    registerExpense,
    transitionState,
    messagingPort,
  });

  return {
    useCase,
    registerExpense,
    transitionState,
    messagingPort,
    saveMock,
    transitionMock,
    sendMessageMock,
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
      expenseCopies.expenseSavedConfirmation(),
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
    const { useCase, transitionMock, sendMessageMock } = buildUseCase();

    await useCase.execute({
      userId: 'user-123',
      action: 'cancel',
      payload: buildPayload(),
      chatId: '123456789',
    });

    expect(transitionMock).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'IDLE',
      payload: null,
    });
    expect(sendMessageMock).toHaveBeenCalledWith('123456789', expenseCopies.cancelled());
  });
});
