// LAYER: E2E / Application boundary
// Exercises callback-to-authorization behavior with messaging and spreadsheet boundaries mocked.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationState } from '../../domain/entities/ConversationState';
import type { ExpenseReviewPayload } from '../../domain/value-objects/expense-review-payload';
import type { TransitionConversationState } from '../../application/use-cases/conversation/TransitionConversationState';
import type { RegisterExpenseUseCase } from '../../application/use-cases/expense/RegisterExpense';
import type { CancelExpenseRegistrationUseCase } from '../../application/use-cases/expense/CancelExpenseRegistrationUseCase';
import { ResolveExpenseSummaryActionUseCase } from '../../application/use-cases/expense/ResolveExpenseSummaryActionUseCase';

const OLD_BINDING = {
  operationId: 'aaaaaaaaaaaaaaaaaaaaaa',
  revision: 1,
  presentedAt: '2026-09-13T10:00:00.000Z',
} as const;
const CURRENT_BINDING = {
  operationId: OLD_BINDING.operationId,
  revision: 2,
  presentedAt: '2026-09-13T10:02:00.000Z',
} as const;

function review(amount: number, binding = CURRENT_BINDING): ExpenseReviewPayload {
  return {
    rawMessage: `Cena ${amount} EUR`,
    extracted: {
      monto: amount,
      moneda: 'EUR',
      categoriaRaw: 'cena',
      subcategoriaRaw: null,
      fechaRaw: '2026-09-13',
      medioPago: null,
      confianzaCategoria: 'alta',
      confianzaSubcategoria: 'nula',
    },
    resolvedDate: '2026-09-13',
    resolvedCategory: 'Comida',
    resolvedCategoryId: 'food',
    categoryStatus: 'confirmed',
    resolvedSubcategory: null,
    resolvedSubcategoryId: null,
    subcategoryStatus: 'none',
    subcategoryEnabled: false,
    reviewBinding: binding,
  };
}

describe('expense confirmation context', () => {
  const save = vi.fn<RegisterExpenseUseCase['save']>();
  const cancel = vi.fn();
  const sendMessage = vi.fn();
  let state: ConversationState;
  let useCase: ResolveExpenseSummaryActionUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      userId: 'user-1',
      revision: '8',
      currentState: 'EXPENSE_REVIEW',
      statePayload: review(35) as unknown as Record<string, unknown>,
      expiresAt: new Date('2099-09-13T10:12:00.000Z'),
      enteredAt: new Date('2026-09-13T10:02:00.000Z'),
      updatedAt: new Date('2026-09-13T10:02:00.000Z'),
    };
    save.mockResolvedValue({ sheetName: 'Gastos', rowIndex: 7 });
    sendMessage.mockResolvedValue({ status: 'success' });

    const transitionState = {
      currentState: () => state,
      execute: vi.fn((input: Parameters<TransitionConversationState['execute']>[0]) => {
        state = {
          ...state,
          revision: String(Number(state.revision) + 1),
          currentState: input.targetState,
          statePayload: input.payload ?? null,
          expiresAt: input.expiresAt ?? null,
        };
        return Promise.resolve({ status: 'updated' as const, state });
      }),
      finalizeClaim: vi.fn(() => Promise.resolve({ status: 'updated' as const, state })),
    } as unknown as TransitionConversationState;

    useCase = new ResolveExpenseSummaryActionUseCase({
      registerExpense: { save } as unknown as RegisterExpenseUseCase,
      transitionState,
      messagingPort: { sendMessage },
      cancelExpenseRegistration: { execute: cancel } as unknown as CancelExpenseRegistrationUseCase,
      operationLogRepo: { create: vi.fn() },
      advancePendingExpense: { execute: vi.fn().mockResolvedValue({ status: 'empty' }) } as never,
    });
  });

  const callback = (
    action: 'confirm' | 'correct' | 'cancel',
    binding: typeof OLD_BINDING | typeof CURRENT_BINDING,
  ) => ({
    userId: 'user-1',
    action,
    chatId: 'chat-1',
    channel: 'telegram' as const,
    authorization: {
      kind: 'callback' as const,
      callbackData: {
        version: 1 as const,
        action,
        operationId: binding.operationId,
        reviewRevision: binding.revision,
      },
      receivedAt: '2026-09-13T10:03:00.000Z',
      sourceMessageId: `callback-${action}-${binding.revision}`,
    },
  });

  it('rejects every old button after a 30 EUR review is corrected to 35 EUR', async () => {
    for (const action of ['confirm', 'cancel', 'correct'] as const) {
      await expect(useCase.execute(callback(action, OLD_BINDING))).resolves.toEqual({
        status: 'stale',
      });
    }

    expect(save).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(state.currentState).toBe('EXPENSE_REVIEW');
    expect((state.statePayload?.extracted as { monto: number }).monto).toBe(35);
  });

  it('saves the persisted corrected amount once and rejects duplicate delivery', async () => {
    const spoofedPayload = review(999, CURRENT_BINDING);
    const input = { ...callback('confirm', CURRENT_BINDING), payload: spoofedPayload };
    const duplicate = {
      ...input,
      authorization: { ...input.authorization, sourceMessageId: 'callback-confirm-duplicate' },
    };

    await expect(useCase.execute(input)).resolves.toEqual({ status: 'handled', action: 'confirm' });
    await expect(useCase.execute(duplicate)).resolves.toEqual({ status: 'stale' });

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[1].extracted.monto).toBe(35);
  });

  it.each([
    [{ action: 'confirm' as const }, 'unbound'],
    [{ invalid: true as const }, 'invalid'],
  ])('rejects legacy and malformed callback evidence', async (callbackData, status) => {
    await expect(
      useCase.execute({
        userId: 'user-1',
        chatId: 'chat-1',
        authorization: {
          kind: 'callback',
          callbackData,
          receivedAt: '2026-09-13T10:03:00.000Z',
          sourceMessageId: 'callback-invalid',
        },
      }),
    ).resolves.toEqual({ status });
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects text captured before the current presentation', async () => {
    await expect(
      useCase.execute({
        userId: 'user-1',
        action: 'confirm',
        chatId: 'chat-1',
        authorization: {
          kind: 'text',
          receivedAt: CURRENT_BINDING.presentedAt,
          sourceMessageId: 'queued-before-presentation',
        },
      }),
    ).resolves.toEqual({ status: 'unbound' });
    expect(save).not.toHaveBeenCalled();
  });

  it('turns zero acceptance into a newly bound review instead of saving', async () => {
    state = {
      ...state,
      statePayload: {
        ...review(0),
        awaitingZeroConfirmation: true,
      },
    };

    const outcome = await useCase.execute(callback('confirm', CURRENT_BINDING));

    expect(outcome.status).toBe('review_required');
    expect(save).not.toHaveBeenCalled();
    expect(state.currentState).toBe('EXPENSE_REVIEW');
    expect(state.statePayload?.awaitingZeroConfirmation).toBe(false);
    expect((state.statePayload?.reviewBinding as { revision: number }).revision).toBe(3);
  });

  it('rejects an expired review before the timeout sweep runs', async () => {
    state = { ...state, expiresAt: new Date('2000-01-01T00:00:00.000Z') };

    await expect(useCase.execute(callback('confirm', CURRENT_BINDING))).resolves.toEqual({
      status: 'expired',
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects replacement while a financial claim is unresolved', async () => {
    state = {
      ...state,
      statePayload: {
        ...review(35),
        executionClaim: {
          claimId: 'claim-1',
          kind: 'save',
          operationId: CURRENT_BINDING.operationId,
          sourceMessageId: 'callback-1',
          status: 'in_flight',
          target: { expense: review(35) },
        },
      },
    };

    await expect(useCase.execute(callback('cancel', CURRENT_BINDING))).resolves.toEqual({
      status: 'operation_in_progress',
    });
    expect(cancel).not.toHaveBeenCalled();
  });
});
