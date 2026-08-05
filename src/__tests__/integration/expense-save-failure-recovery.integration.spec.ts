// LAYER: Application / Integration Tests
// Wires the expense save orchestration through its real use cases while
// replacing database, messaging, token, and Google Sheets boundaries.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResolveExpenseSummaryActionUseCase } from '../../application/use-cases/expense/ResolveExpenseSummaryActionUseCase';
import { RegisterExpenseUseCase } from '../../application/use-cases/expense/RegisterExpense';
import { TransitionConversationState } from '../../application/use-cases/conversation/TransitionConversationState';
import { SpreadsheetError } from '../../domain/errors/SpreadsheetError';
import type { ConversationState, FsmState } from '../../domain/entities/ConversationState';
import type { ExpenseReviewPayload } from '../../domain/value-objects/expense-review-payload';

const payload: ExpenseReviewPayload = {
  rawMessage: 'Café 100 EUR',
  extracted: {
    monto: 100,
    moneda: 'EUR',
    categoriaRaw: 'café',
    fechaRaw: '2026-08-04',
    medioPago: null,
    confianzaCategoria: 'alta',
  },
  resolvedDate: '2026-08-04',
  resolvedCategory: 'Comida',
  resolvedCategoryId: null,
  categoryStatus: 'confirmed',
};

describe('expense save failure recovery', () => {
  let state: ConversationState;
  const appendRow = vi.fn();
  const createExpenseRecord = vi.fn();
  const sendMessage = vi.fn();
  const createOperationLog = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      userId: 'user-123',
      currentState: 'EXPENSE_REVIEW',
      statePayload: { ...payload },
      enteredAt: new Date('2026-08-04T12:00:00.000Z'),
      expiresAt: new Date('2026-08-04T12:10:00.000Z'),
      updatedAt: new Date('2026-08-04T12:00:00.000Z'),
    };
    appendRow.mockRejectedValue(
      new SpreadsheetError('Google Sheets request timed out', {
        code: 'NETWORK_ERROR',
        retryable: true,
      }),
    );
    createExpenseRecord.mockResolvedValue({ id: 'expense-1' });
    sendMessage.mockResolvedValue({ status: 'success' });
    createOperationLog.mockResolvedValue({});
  });

  it('emits recovery copy without recording or confirming an unconfirmed append', async () => {
    const conversationRepository = {
      findByUserId: vi.fn(() => Promise.resolve(state)),
      transition: vi.fn(
        (
          _userId: string,
          currentState: FsmState,
          statePayload: Record<string, unknown> | null,
          expiresAt: Date | null,
        ) => {
        state = {
          ...state,
          currentState,
          statePayload,
          expiresAt,
          updatedAt: new Date(),
        };
          return Promise.resolve(state);
        },
      ),
    };
    const transitionState = new TransitionConversationState(conversationRepository as never);
    const registerExpense = new RegisterExpenseUseCase(
      {} as never,
      { create: vi.fn(() => ({ appendRow })) } as never,
      { create: createExpenseRecord } as never,
      {
        findByUserId: vi.fn().mockResolvedValue({
          id: 'config-1',
          userId: 'user-123',
          provider: 'google',
          fileId: 'file-1',
          fileName: 'Gastos',
          sheetName: 'Hoja 1',
        }),
      } as never,
      {
        findBySpreadsheetId: vi.fn().mockResolvedValue([
          { GasttoField: 'monto', columnIndex: 0 },
        ]),
      } as never,
      {} as never,
      conversationRepository as never,
      { create: createOperationLog },
      {} as never,
      {} as never,
      {
        findByUserAndProvider: vi.fn().mockResolvedValue({
          accessTokenEnc: Buffer.from('encrypted'),
          iv: Buffer.from('iv'),
          accessTokenExpiresAt: new Date('2030-08-05T12:00:00.000Z'),
          revokedAt: null,
        }),
      } as never,
      { decrypt: vi.fn().mockReturnValue('access-token') } as never,
    );
    const useCase = new ResolveExpenseSummaryActionUseCase({
      registerExpense,
      transitionState,
      messagingPort: { sendMessage },
      cancelExpenseRegistration: {} as never,
      operationLogRepo: { create: createOperationLog },
    });

    await useCase.execute({
      userId: 'user-123',
      chatId: 'chat-123',
      action: 'confirm',
      payload,
    });

    expect(appendRow).toHaveBeenCalledOnce();
    expect(createExpenseRecord).not.toHaveBeenCalled();
    expect(state.currentState).toBe('EXPENSE_SAVING_RETRY');
    expect(state.statePayload).toMatchObject({
      expense: payload,
      failureCode: 'NETWORK_ERROR',
      attemptCount: 1,
    });
    expect(state.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    expect(sendMessage).toHaveBeenCalledWith('chat-123', expect.stringContaining('reintentar'));
    expect(sendMessage).not.toHaveBeenCalledWith('chat-123', expect.stringContaining('✅ *Gasto guardado*'));
  });
});
