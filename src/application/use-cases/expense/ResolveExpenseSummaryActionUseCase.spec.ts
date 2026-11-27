// LAYER: Application / Tests
// Unit tests for ResolveExpenseSummaryActionUseCase.
// Mocks the register-expense use case, transition use case, and messaging port
// so only the action-resolution logic is exercised.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResolveExpenseSummaryActionUseCase } from './ResolveExpenseSummaryActionUseCase';
import type { CancelExpenseRegistrationUseCase } from './CancelExpenseRegistrationUseCase';
import type { RegisterExpenseUseCase } from './RegisterExpense';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { expenseCopies } from '../../copies/expense.copies';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import type { IOperationLogRepository } from '../../../domain/ports/repositories';
import { AccountDeletionInProgressError } from '../../ports/AccountExternalWorkFence';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import { ResolveExpenseCategoryChoice } from './ResolveExpenseCategoryChoice';
import { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';

function buildPayload(overrides: Partial<ExpenseReviewPayload> = {}): ExpenseReviewPayload {
  return {
    rawMessage: 'Cafe 850 ARS',
    extracted: {
      monto: 850,
      moneda: 'ARS',
      categoriaRaw: 'café',
      subcategoriaRaw: null,
      fechaRaw: '2026-07-25',
      medioPago: null,
      confianzaCategoria: 'alta',
      confianzaSubcategoria: 'nula',
    },
    resolvedDate: '2026-07-25',
    resolvedCategory: 'Comida',
    resolvedCategoryId: null,
    categoryStatus: 'confirmed',
    resolvedSubcategory: null,
    resolvedSubcategoryId: null,
    subcategoryStatus: 'none',
    subcategoryEnabled: false,
    paymentMethodSelection: {
      status: 'legacy',
      sourceConfigId: null,
      paymentMethodId: null,
      canonicalName: null,
      unresolvedRaw: null,
    },
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
    advancePendingExpense?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const reviewBinding = {
    operationId: 'abcdefghijklmnopqrstuv',
    revision: 1,
    presentedAt: '2026-07-25T10:00:00.000Z',
  } as const;
  const saveMock: ReturnType<typeof vi.fn<RegisterExpenseUseCase['save']>> =
    overrides.save ??
    vi.fn<RegisterExpenseUseCase['save']>().mockResolvedValue({ sheetName: 'Hoja 1', rowIndex: 2 });
  const transitionMock: ReturnType<typeof vi.fn<TransitionConversationState['execute']>> =
    overrides.transition ??
    vi.fn<TransitionConversationState['execute']>().mockResolvedValue({
      status: 'updated',
      state: {
        userId: 'user-123',
        revision: '1',
        currentState: 'EXPENSE_CORRECTING',
        statePayload: null,
        expiresAt: null,
        enteredAt: new Date(),
        updatedAt: new Date(),
      },
    });
  const sendMessageMock: ReturnType<typeof vi.fn<MessagingOutputPort['sendMessage']>> =
    overrides.sendMessage ??
    vi.fn<MessagingOutputPort['sendMessage']>().mockResolvedValue({ status: 'success' });

  const registerExpense = { save: saveMock } as unknown as RegisterExpenseUseCase;
  const currentState = vi.fn();
  const transitionState = {
    execute: transitionMock,
    currentState,
    finalizeClaim: transitionMock,
  } as unknown as TransitionConversationState;
  const messagingPort = { sendMessage: sendMessageMock };
  const cancelExpenseRegistration = {
    execute:
      overrides.cancelExpenseRegistration ?? vi.fn().mockResolvedValue({ status: 'cancelled' }),
  };
  const operationLogCreate =
    overrides.operationLogCreate ??
    vi.fn<IOperationLogRepository['create']>().mockResolvedValue({} as never);
  const advancePendingExpense =
    overrides.advancePendingExpense ?? vi.fn().mockResolvedValue({ status: 'empty' });

  const subject = new ResolveExpenseSummaryActionUseCase({
    registerExpense,
    transitionState,
    messagingPort,
    cancelExpenseRegistration:
      cancelExpenseRegistration as unknown as CancelExpenseRegistrationUseCase,
    operationLogRepo: { create: operationLogCreate },
    advancePendingExpense: { execute: advancePendingExpense } as never,
  });
  const useCase = {
    execute: (input: Parameters<ResolveExpenseSummaryActionUseCase['execute']>[0]) => {
      const payload = input.payload ?? buildPayload();
      payload.reviewBinding = reviewBinding;
      currentState.mockReturnValue({
        userId: input.userId,
        revision: '0',
        currentState: 'EXPENSE_REVIEW',
        statePayload: payload,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        enteredAt: new Date(),
        updatedAt: new Date(),
      });
      return subject.execute({
        ...input,
        authorization: {
          kind: 'callback',
          callbackData: {
            version: 1,
            action: input.action ?? 'confirm',
            operationId: reviewBinding.operationId,
            reviewRevision: reviewBinding.revision,
          },
          receivedAt: '2026-07-25T10:01:00.000Z',
          sourceMessageId: 'callback-1',
        },
      });
    },
  } as ResolveExpenseSummaryActionUseCase;

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
    advancePendingExpense,
  };
}

describe('ResolveExpenseSummaryActionUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects confirmation of an unresolved payment before claiming or saving', async () => {
    const { useCase, saveMock, transitionMock, sendMessageMock } = buildUseCase();
    const payload = buildPayload({
      paymentMethodSelection: {
        status: 'unresolved',
        sourceConfigId: 'config-1',
        paymentMethodId: null,
        canonicalName: null,
        unresolvedRaw: 'Tarjeta nueva',
      },
    });
    await expect(
      useCase.execute({ userId: 'user-123', action: 'confirm', payload, chatId: 'chat' }),
    ).resolves.toEqual({ status: 'payment_unresolved' });
    expect(transitionMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('confirm sends saving message, saves the expense, and sends confirmation', async () => {
    const { useCase, saveMock, sendMessageMock, advancePendingExpense } = buildUseCase();
    const payload = buildPayload();

    await useCase.execute({
      userId: 'user-123',
      action: 'confirm',
      payload,
      chatId: '123456789',
    });

    expect(sendMessageMock).toHaveBeenNthCalledWith(1, '123456789', expenseCopies.saving());
    expect(saveMock).toHaveBeenCalledWith('user-123', payload, '', expect.any(String));
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
    expect(advancePendingExpense).toHaveBeenCalledWith({
      userId: 'user-123',
      chatId: '123456789',
      channel: 'telegram',
      reason: 'confirmed',
      completedCount: 1,
    });
    expect(sendMessageMock.mock.invocationCallOrder[1]).toBeLessThan(
      advancePendingExpense.mock.invocationCallOrder[0]!,
    );
  });

  it('does not turn an account deletion fence rejection into a save failure', async () => {
    const save = vi
      .fn<RegisterExpenseUseCase['save']>()
      .mockRejectedValue(new AccountDeletionInProgressError());
    const { useCase, sendMessageMock, operationLogCreate } = buildUseCase({ save });
    await expect(
      useCase.execute({
        userId: 'user-123',
        action: 'confirm',
        payload: buildPayload(),
        chatId: 'chat',
      }),
    ).rejects.toBeInstanceOf(AccountDeletionInProgressError);
    expect(operationLogCreate).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith('chat', expenseCopies.saving());
  });

  it('saves the corrected expense exactly once only after explicit confirmation', async () => {
    const save = vi
      .fn<RegisterExpenseUseCase['save']>()
      .mockResolvedValue({ sheetName: 'T 6', rowIndex: 44 });
    const { useCase, sendMessageMock } = buildUseCase({ save });
    const correctedPayload = buildPayload({
      rawMessage: 'Pague 30 euros por taxi',
      extracted: {
        monto: 35,
        moneda: 'EUR',
        categoriaRaw: 'transporte',
        subcategoriaRaw: null,
        fechaRaw: null,
        medioPago: null,
        confianzaCategoria: 'alta',
        confianzaSubcategoria: 'nula',
      },
      resolvedCategory: 'Transporte',
    });

    expect(save).not.toHaveBeenCalled();

    await useCase.execute({
      userId: 'user-123',
      action: 'confirm',
      payload: correctedPayload,
      chatId: '123456789',
    });

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('user-123', correctedPayload, '', expect.any(String));
    expect(sendMessageMock).toHaveBeenLastCalledWith(
      '123456789',
      expect.stringContaining('Monto: 35 EUR'),
    );
    expect(sendMessageMock.mock.calls.flat().join('\n')).not.toContain('Monto: 30 EUR');
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
    const { useCase, sendMessageMock, transitionMock, operationLogCreate, advancePendingExpense } =
      buildUseCase({ save });
    const payload = buildPayload({
      extracted: {
        monto: 850,
        moneda: 'ARS',
        categoriaRaw: 'comida',
        subcategoriaRaw: 'Restaurante',
        fechaRaw: '2026-07-25',
        medioPago: 'Tarjeta',
        confianzaCategoria: 'alta',
        confianzaSubcategoria: 'alta',
      },
      resolvedCategoryId: 'category-food',
      resolvedSubcategory: 'Restaurante',
      resolvedSubcategoryId: 'subcategory-restaurant',
      subcategoryStatus: 'confirmed',
      subcategoryEnabled: true,
    });

    await useCase.execute({
      userId: 'user-123',
      action: 'confirm',
      payload,
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
    });
    expect(retryTransition.payload?.expense).toEqual(payload);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('user-123', payload, '', expect.any(String));
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
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(advancePendingExpense).not.toHaveBeenCalled();
  });

  it('persists an unresolved claim and does not offer retry when append outcome is unknown', async () => {
    const save = vi.fn<RegisterExpenseUseCase['save']>().mockRejectedValue(
      new SpreadsheetError('Connection closed after append request', {
        code: 'NETWORK_ERROR',
        retryable: true,
        outcomeUnknown: true,
      }),
    );
    const { useCase, transitionMock, sendMessageMock, advancePendingExpense } = buildUseCase({
      save,
    });

    await useCase.execute({
      userId: 'user-123',
      action: 'confirm',
      payload: buildPayload(),
      chatId: '123456789',
    });

    expect(transitionMock).toHaveBeenCalledTimes(2);
    expect(transitionMock.mock.calls[1]?.[0]).toMatchObject({
      userId: 'user-123',
      targetState: 'EXPENSE_SAVING',
      payload: { executionClaim: { status: 'outcome_unknown' } },
    });
    expect(sendMessageMock).toHaveBeenLastCalledWith(
      '123456789',
      expenseCopies.financialOutcomeUnknown(),
    );
    expect(advancePendingExpense).not.toHaveBeenCalled();
  });

  it('starts contextual onboarding and sends authorization recovery copy for an auth failure', async () => {
    const save = vi
      .fn<RegisterExpenseUseCase['save']>()
      .mockRejectedValue(new SpreadsheetError('Access token expired', { code: 'AUTH_ERROR' }));
    const { useCase, sendMessageMock, transitionMock, advancePendingExpense } = buildUseCase({
      save,
    });

    await useCase.execute({
      userId: 'user-123',
      action: 'confirm',
      payload: buildPayload(),
      chatId: '123456789',
    });

    const claimId = transitionMock.mock.calls[0]?.[0].claimId;
    expect(typeof claimId).toBe('string');
    expect(transitionMock).toHaveBeenLastCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true, reauthorizationOnly: true },
      claimId,
    });
    const recoveryTransition = transitionMock.mock.calls[transitionMock.mock.calls.length - 1]?.[0];
    expect(recoveryTransition?.payload).not.toHaveProperty('expense');
    expect(sendMessageMock).toHaveBeenLastCalledWith(
      '123456789',
      expenseCopies.saveAuthorizationFailure(),
    );
    expect(sendMessageMock).not.toHaveBeenCalledWith(
      '123456789',
      expect.stringContaining('Gasto guardado'),
    );
    expect(advancePendingExpense).not.toHaveBeenCalled();
  });

  it('keeps structure failures terminal in IDLE', async () => {
    const save = vi
      .fn<RegisterExpenseUseCase['save']>()
      .mockRejectedValue(new SpreadsheetError('Sheet changed', { code: 'STRUCTURE_ERROR' }));
    const { useCase, sendMessageMock, transitionMock } = buildUseCase({ save });

    await useCase.execute({
      userId: 'user-123',
      action: 'confirm',
      payload: buildPayload(),
      chatId: '123456789',
    });

    const claimId = transitionMock.mock.calls[0]?.[0].claimId;
    expect(typeof claimId).toBe('string');
    expect(transitionMock).toHaveBeenLastCalledWith({
      userId: 'user-123',
      targetState: 'IDLE',
      claimId,
    });
    expect(sendMessageMock).toHaveBeenLastCalledWith(
      '123456789',
      expenseCopies.saveStructureFailure(),
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
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
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
    expect(sendMessageMock.mock.calls[0]?.[1]).toContain('subcategoría restaurante');
  });

  it.each(['category', 'subcategory'] as const)(
    'can open an unknown %s choice on the turn after pressing correct',
    async (kind) => {
      const payload = buildPayload({
        reviewBinding: {
          operationId: 'abcdefghijklmnopqrstuv',
          revision: 1,
          presentedAt: new Date(Date.now() - 1000).toISOString(),
        },
      });
      const expiresAt = new Date(Date.now() + 600_000);
      let persisted: ConversationState = {
        userId: 'user-123',
        revision: '1',
        currentState: 'EXPENSE_REVIEW',
        statePayload: { ...payload },
        expiresAt,
        enteredAt: new Date(),
        updatedAt: new Date(),
      };
      const transition = vi.fn<IConversationStateRepository['transition']>((input) => {
        persisted = {
          ...persisted,
          revision: String(Number(persisted.revision) + 1),
          currentState: input.nextState,
          statePayload: input.payload,
          expiresAt: input.expiresAt,
          updatedAt: new Date(),
        };
        return Promise.resolve({ status: 'updated', state: persisted });
      });
      const transitionState = new TransitionConversationState({
        transition,
      } as unknown as IConversationStateRepository);
      const save = vi.fn();
      const subject = new ResolveExpenseSummaryActionUseCase({
        transitionState,
        registerExpense: { save } as unknown as RegisterExpenseUseCase,
        messagingPort: { sendMessage: vi.fn().mockResolvedValue({ status: 'success' }) },
        cancelExpenseRegistration: {} as CancelExpenseRegistrationUseCase,
        operationLogRepo: {} as IOperationLogRepository,
      });
      await transitionState.runWithState(persisted, () =>
        subject.execute({
          userId: persisted.userId,
          action: 'correct',
          chatId: '123456789',
          authorization: {
            kind: 'callback',
            callbackData: {
              version: 1,
              action: 'correct',
              operationId: payload.reviewBinding!.operationId,
              reviewRevision: 1,
            },
            receivedAt: new Date().toISOString(),
            sourceMessageId: 'correct-1',
          },
        }),
      );
      const commit = {
        load: vi.fn().mockResolvedValue({ categories: [], subcategories: [] }),
        execute: vi.fn(),
      };
      const choice = new ResolveExpenseCategoryChoice({ transitionState, commit });
      const original = ExpenseCorrectionState.fromPayload(persisted.statePayload).payload;
      const common = {
        attemptedName: kind === 'category' ? 'gastodiario' : 'comida',
        suggestedName: null,
        candidates: [],
        sourceConfigId: 'sheet-1',
        payload: original,
        correctionCycles: 0,
      };
      const result = await transitionState.runWithState(persisted, () =>
        choice.start({
          userId: persisted.userId,
          original,
          correction:
            kind === 'category'
              ? { ...common, status: 'unresolved_category' }
              : {
                  ...common,
                  status: 'unresolved_subcategory',
                  parentCategoryId: 'parent-1',
                  parentCategoryName: 'gastodiario',
                  subcategoryColumnMapped: true,
                },
        }),
      );
      expect(result).toMatchObject({ status: 'choose', choice: { kind, original } });
      expect(persisted.expiresAt).toEqual(expiresAt);
      expect(save).not.toHaveBeenCalled();
      expect(commit.execute).not.toHaveBeenCalled();
    },
  );

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

  it('sends the batch closing summary only after the final queued expense is saved', async () => {
    const { useCase, sendMessageMock, advancePendingExpense } = buildUseCase({
      advancePendingExpense: vi.fn().mockResolvedValue({ status: 'empty' }),
    });

    await useCase.execute({
      userId: 'user-123',
      action: 'confirm',
      payload: buildPayload({ queueRegisteredCount: 2 }),
      chatId: '123456789',
    });

    expect(advancePendingExpense).toHaveBeenCalledWith({
      userId: 'user-123',
      chatId: '123456789',
      channel: 'telegram',
      reason: 'confirmed',
      completedCount: 3,
    });
    expect(sendMessageMock).toHaveBeenLastCalledWith(
      '123456789',
      expenseCopies.expenseQueueClosingSummary(3),
    );
    expect(advancePendingExpense.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessageMock.mock.invocationCallOrder[2]!,
    );
  });
});
