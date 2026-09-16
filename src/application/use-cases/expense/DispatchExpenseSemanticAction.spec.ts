import { describe, expect, it, vi } from 'vitest';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { DispatchExpenseSemanticAction } from './DispatchExpenseSemanticAction';

const state: ConversationState = {
  userId: 'user-1',
  revision: '7',
  currentState: 'IDLE',
  statePayload: null,
  enteredAt: new Date('2026-09-15T10:00:00.000Z'),
  expiresAt: null,
  updatedAt: new Date('2026-09-15T10:00:00.000Z'),
};

const payload = {
  extracted: {
    monto: 16.55,
    moneda: 'EUR',
    categoriaRaw: 'Mercadona',
    subcategoriaRaw: null,
    fechaRaw: '2026-09-11',
    medioPago: 'CREDITO SANTANDER',
    confianzaCategoria: 'alta',
    confianzaSubcategoria: 'nula',
  },
  rawMessage: 'Mercadona 16,55 EUR',
  resolvedDate: '2026-09-11',
  resolvedCategory: null,
  resolvedCategoryId: null,
  categoryStatus: 'none',
} satisfies ExpenseReviewPayload;

function input(overrides: Partial<Parameters<DispatchExpenseSemanticAction['execute']>[0]> = {}) {
  return {
    userId: 'user-1',
    externalId: 'chat-1',
    externalMessageId: 'message-1',
    receivedAt: '2026-09-15T10:00:00.000Z',
    channel: 'telegram' as const,
    rawMessage: payload.rawMessage,
    conversationState: state,
    expected: { revision: '7', currentState: 'IDLE', expiry: 'unexpired' as const },
    decision: { action: 'register_expense' as const },
    ...overrides,
  };
}

describe('DispatchExpenseSemanticAction', () => {
  it('revalidates the snapshot and passes the unchanged original message to interpretation', async () => {
    const interpret = vi.fn().mockResolvedValue({ status: 'ready_for_review', payload });
    const snapshotValidator = {
      execute: vi.fn().mockResolvedValue({ status: 'current', state }),
    };
    const useCase = new DispatchExpenseSemanticAction({
      snapshotValidator,
      registerExpense: { interpret },
      completeClarification: { execute: vi.fn() },
      correctExpense: { execute: vi.fn() },
      queuePendingExpense: { execute: vi.fn() },
    });

    await expect(useCase.execute(input())).resolves.toEqual({
      status: 'review_required',
      payload,
    });
    expect(snapshotValidator.execute).toHaveBeenCalledWith({
      userId: 'user-1',
      expected: input().expected,
    });
    expect(interpret).toHaveBeenCalledWith({
      userId: 'user-1',
      rawMessage: payload.rawMessage,
      channel: 'telegram',
    });
  });

  it('maps missing data and zero-amount review without adding a save capability', async () => {
    const interpret = vi
      .fn()
      .mockResolvedValueOnce({ status: 'needs_clarification', missingField: 'moneda' })
      .mockResolvedValueOnce({
        status: 'needs_zero_confirmation',
        payload: { ...payload, awaitingZeroConfirmation: true },
      });
    const useCase = new DispatchExpenseSemanticAction({
      snapshotValidator: { execute: vi.fn().mockResolvedValue({ status: 'current', state }) },
      registerExpense: { interpret },
      completeClarification: { execute: vi.fn() },
      correctExpense: { execute: vi.fn() },
      queuePendingExpense: { execute: vi.fn() },
    });

    await expect(useCase.execute(input())).resolves.toEqual({
      status: 'missing_data',
      field: 'moneda',
    });
    await expect(useCase.execute(input())).resolves.toMatchObject({
      status: 'review_required',
      payload: { awaitingZeroConfirmation: true },
    });
    expect(Object.keys(useCase)).not.toContain('save');
  });

  it.each(['stale', 'expired', 'missing', 'operation_in_progress'] as const)(
    'rejects a %s snapshot before interpretation',
    async (status) => {
      const interpret = vi.fn();
      const useCase = new DispatchExpenseSemanticAction({
        snapshotValidator: { execute: vi.fn().mockResolvedValue({ status }) },
        registerExpense: { interpret },
        completeClarification: { execute: vi.fn() },
        correctExpense: { execute: vi.fn() },
        queuePendingExpense: { execute: vi.fn() },
      });

      await expect(useCase.execute(input())).resolves.toEqual({
        status: 'clarification_required',
        reason: 'stale_context',
      });
      expect(interpret).not.toHaveBeenCalled();
    },
  );

  it('fails closed when interpretation throws', async () => {
    const useCase = new DispatchExpenseSemanticAction({
      snapshotValidator: { execute: vi.fn().mockResolvedValue({ status: 'current', state }) },
      registerExpense: { interpret: vi.fn().mockRejectedValue(new Error('extractor failed')) },
      completeClarification: { execute: vi.fn() },
      correctExpense: { execute: vi.fn() },
      queuePendingExpense: { execute: vi.fn() },
    });

    await expect(useCase.execute(input())).resolves.toEqual({
      status: 'clarification_required',
      reason: 'dispatch_failed',
    });
  });

  it('completes clarification through the dedicated boundary with the persisted payload', async () => {
    const clarifying = {
      ...state,
      currentState: 'EXPENSE_CLARIFYING' as const,
      statePayload: {
        _type: 'ExpenseClarificationState',
        missingField: 'moneda',
        partialExtracted: { ...payload.extracted, moneda: null },
        rawMessage: 'Mercadona 16,55',
        queueRegisteredCount: 1,
      },
    };
    const complete = vi.fn().mockResolvedValue({ status: 'ready_for_review', payload });
    const useCase = new DispatchExpenseSemanticAction({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: clarifying }),
      },
      registerExpense: { interpret: vi.fn() },
      completeClarification: { execute: complete },
      correctExpense: { execute: vi.fn() },
      queuePendingExpense: { execute: vi.fn() },
    });

    await expect(
      useCase.execute(
        input({
          conversationState: clarifying,
          expected: {
            revision: '7',
            currentState: 'EXPENSE_CLARIFYING',
            expiry: 'unexpired',
          },
          rawMessage: 'euros',
          decision: { action: 'provide_missing_expense_data' },
        }),
      ),
    ).resolves.toEqual({ status: 'review_required', payload });
    expect(complete).toHaveBeenCalledWith({
      userId: 'user-1',
      rawReply: 'euros',
      channel: 'telegram',
      statePayload: clarifying.statePayload,
    });
  });

  it('queues a semantic new expense during review without correction interpretation', async () => {
    const review = { ...state, currentState: 'EXPENSE_REVIEW' as const, statePayload: payload };
    const queue = vi.fn().mockResolvedValue({ status: 'queued', pendingCount: 1 });
    const correct = vi.fn();
    const useCase = new DispatchExpenseSemanticAction({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: review }),
      },
      registerExpense: { interpret: vi.fn() },
      completeClarification: { execute: vi.fn() },
      queuePendingExpense: { execute: queue },
      correctExpense: { execute: correct },
    });

    await expect(
      useCase.execute(
        input({
          conversationState: review,
          expected: { revision: '7', currentState: 'EXPENSE_REVIEW', expiry: 'unexpired' },
        }),
      ),
    ).resolves.toEqual({ status: 'expense_queued', pendingCount: 1 });
    expect(queue).toHaveBeenCalledOnce();
    expect(correct).not.toHaveBeenCalled();
  });

  it('uses validated correction mode and returns a fresh review', async () => {
    const review = { ...state, currentState: 'EXPENSE_REVIEW' as const, statePayload: payload };
    const corrected = { ...payload, extracted: { ...payload.extracted, monto: 25 } };
    const correct = vi.fn().mockResolvedValue({ status: 'corrected', payload: corrected });
    const useCase = new DispatchExpenseSemanticAction({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: review }),
      },
      registerExpense: { interpret: vi.fn() },
      completeClarification: { execute: vi.fn() },
      correctExpense: { execute: correct },
      queuePendingExpense: { execute: vi.fn() },
    });

    await expect(
      useCase.execute(
        input({
          conversationState: review,
          expected: { revision: '7', currentState: 'EXPENSE_REVIEW', expiry: 'unexpired' },
          rawMessage: 'sí, pero cambia el importe a 25',
          decision: { action: 'correct_expense' },
        }),
      ),
    ).resolves.toEqual({ status: 'review_required', payload: corrected });
    expect(correct).toHaveBeenCalledWith(
      expect.objectContaining({
        rawMessage: 'sí, pero cambia el importe a 25',
        intentMode: 'validated_correction',
      }),
    );
  });

  it('replaces a clarification with only the new original message and preserves queue progress', async () => {
    const clarifying = {
      ...state,
      currentState: 'EXPENSE_CLARIFYING' as const,
      statePayload: {
        _type: 'ExpenseClarificationState',
        missingField: 'monto',
        partialExtracted: { ...payload.extracted, monto: null },
        rawMessage: 'Borrador anterior',
        queueRegisteredCount: 2,
      },
    };
    const interpret = vi.fn().mockResolvedValue({ status: 'ready_for_review', payload });
    const useCase = new DispatchExpenseSemanticAction({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: clarifying }),
      },
      registerExpense: { interpret },
      completeClarification: { execute: vi.fn() },
      correctExpense: { execute: vi.fn() },
      queuePendingExpense: { execute: vi.fn() },
    });

    await expect(
      useCase.execute(
        input({
          conversationState: clarifying,
          expected: {
            revision: '7',
            currentState: 'EXPENSE_CLARIFYING',
            expiry: 'unexpired',
          },
          rawMessage: 'Taxi 25 EUR',
        }),
      ),
    ).resolves.toEqual({ status: 'review_required', payload });
    expect(interpret).toHaveBeenCalledOnce();
    expect(interpret).toHaveBeenCalledWith({
      userId: 'user-1',
      rawMessage: 'Taxi 25 EUR',
      channel: 'telegram',
      queueRegisteredCount: 2,
    });
  });

  it('does not report a clarification replacement when extraction fails', async () => {
    const clarifying = {
      ...state,
      currentState: 'EXPENSE_CLARIFYING' as const,
      statePayload: {
        _type: 'ExpenseClarificationState',
        missingField: 'monto',
        partialExtracted: { ...payload.extracted, monto: null },
        rawMessage: 'Borrador anterior',
      },
    };
    const useCase = new DispatchExpenseSemanticAction({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: clarifying }),
      },
      registerExpense: { interpret: vi.fn().mockRejectedValue(new Error('extractor failed')) },
      completeClarification: { execute: vi.fn() },
      correctExpense: { execute: vi.fn() },
      queuePendingExpense: { execute: vi.fn() },
    });

    await expect(
      useCase.execute(
        input({
          conversationState: clarifying,
          expected: {
            revision: '7',
            currentState: 'EXPENSE_CLARIFYING',
            expiry: 'unexpired',
          },
          rawMessage: 'Taxi 25 EUR',
        }),
      ),
    ).resolves.toEqual({ status: 'clarification_required', reason: 'dispatch_failed' });
  });

  it('reports review queue overflow without invoking correction interpretation', async () => {
    const review = { ...state, currentState: 'EXPENSE_REVIEW' as const, statePayload: payload };
    const correct = vi.fn();
    const useCase = new DispatchExpenseSemanticAction({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: review }),
      },
      registerExpense: { interpret: vi.fn() },
      completeClarification: { execute: vi.fn() },
      correctExpense: { execute: correct },
      queuePendingExpense: {
        execute: vi.fn().mockResolvedValue({ status: 'full', pendingCount: 2 }),
      },
    });

    await expect(
      useCase.execute(
        input({
          conversationState: review,
          expected: { revision: '7', currentState: 'EXPENSE_REVIEW', expiry: 'unexpired' },
          rawMessage: 'Taxi 25 EUR',
        }),
      ),
    ).resolves.toEqual({ status: 'queue_full', pendingCount: 2 });
    expect(correct).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_subcategory', 'invalid_subcategory'],
    ['cycle_limit', 'correction_cycle_limit'],
    ['not_interpretable', 'correction_not_interpretable'],
  ] as const)('maps %s correction outcomes to bounded guidance', async (status, reason) => {
    const review = { ...state, currentState: 'EXPENSE_REVIEW' as const, statePayload: payload };
    const useCase = new DispatchExpenseSemanticAction({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: review }),
      },
      registerExpense: { interpret: vi.fn() },
      completeClarification: { execute: vi.fn() },
      correctExpense: { execute: vi.fn().mockResolvedValue({ status }) },
      queuePendingExpense: { execute: vi.fn() },
    });

    await expect(
      useCase.execute(
        input({
          conversationState: review,
          expected: { revision: '7', currentState: 'EXPENSE_REVIEW', expiry: 'unexpired' },
          decision: { action: 'correct_expense' },
        }),
      ),
    ).resolves.toEqual({ status: 'clarification_required', reason });
  });

  it('normalizes a legacy review before one validated correction call', async () => {
    const review = {
      ...state,
      currentState: 'EXPENSE_REVIEW' as const,
      statePayload: payload,
    };
    const correct = vi.fn().mockResolvedValue({ status: 'corrected', payload });
    const useCase = new DispatchExpenseSemanticAction({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: review }),
      },
      registerExpense: { interpret: vi.fn() },
      completeClarification: { execute: vi.fn() },
      correctExpense: { execute: correct },
      queuePendingExpense: { execute: vi.fn() },
    });

    await useCase.execute(
      input({
        conversationState: review,
        expected: { revision: '7', currentState: 'EXPENSE_REVIEW', expiry: 'unexpired' },
        decision: { action: 'correct_expense' },
      }),
    );

    expect(correct).toHaveBeenCalledOnce();
    const correctionInput = correct.mock.calls[0]?.[0] as {
      intentMode: string;
      state: { payload: ExpenseReviewPayload };
    };
    expect(correctionInput.intentMode).toBe('validated_correction');
    expect(correctionInput.state.payload).toMatchObject({
      resolvedSubcategory: null,
      resolvedSubcategoryId: null,
      subcategoryStatus: 'none',
      subcategoryEnabled: false,
    });
  });
});
