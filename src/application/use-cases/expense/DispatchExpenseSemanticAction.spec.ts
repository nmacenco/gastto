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
    });

    await expect(useCase.execute(input())).resolves.toEqual({
      status: 'clarification_required',
      reason: 'dispatch_failed',
    });
  });
});
