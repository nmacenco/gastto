import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationState, FsmState } from '../../../domain/entities/ConversationState';
import { ExpenseClarificationState } from '../../../domain/value-objects/expense-clarification-state';
import { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { DispatchControlSemanticAction } from './DispatchControlSemanticAction';

const review: ExpenseReviewPayload = {
  extracted: {
    monto: 12,
    moneda: 'EUR',
    categoriaRaw: 'Taxi',
    subcategoriaRaw: null,
    fechaRaw: '2026-09-19',
    medioPago: null,
    confianzaCategoria: 'alta',
    confianzaSubcategoria: 'nula',
  },
  rawMessage: 'Taxi 12 EUR',
  resolvedDate: '2026-09-19',
  resolvedCategory: null,
  resolvedCategoryId: null,
  categoryStatus: 'none',
  reviewBinding: {
    operationId: 'abcdefghijklmnopqrstuv',
    revision: 1,
    presentedAt: '2026-09-19T10:00:00.000Z',
  },
};

function state(currentState: FsmState, statePayload: unknown): ConversationState {
  return {
    userId: 'user-1',
    revision: '5',
    currentState,
    statePayload: statePayload as Record<string, unknown> | null,
    enteredAt: new Date('2026-09-19T10:00:00.000Z'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-19T10:00:00.000Z'),
  };
}

describe('DispatchControlSemanticAction', () => {
  const snapshotValidator = { execute: vi.fn() };
  const cancelExpenseRegistration = { execute: vi.fn() };
  const undoLastExpense = { execute: vi.fn() };
  const presentUndoConfirmation = { execute: vi.fn() };
  const dispatcher = new DispatchControlSemanticAction({
    snapshotValidator,
    cancelExpenseRegistration,
    undoLastExpense,
    presentUndoConfirmation,
  });
  const expected = {
    revision: '5',
    currentState: 'EXPENSE_RECEIVING',
    expiry: 'unexpired' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    cancelExpenseRegistration.execute.mockResolvedValue({ status: 'cancelled' });
  });

  it.each([
    ['EXPENSE_RECEIVING', { raw_message: 'Taxi 12 EUR' }],
    [
      'EXPENSE_CLARIFYING',
      ExpenseClarificationState.create('moneda', review.extracted, 'Taxi 12').toPayload(),
    ],
    ['EXPENSE_REVIEW', review],
    ['EXPENSE_CORRECTING', ExpenseCorrectionState.create(review).toPayload()],
  ] as const)(
    'cancels valid %s context through the effect-owning use case',
    async (currentState, payload) => {
      const current = state(currentState, payload);
      snapshotValidator.execute.mockResolvedValue({ status: 'current', state: current });
      const stateExpected = { ...expected, currentState };

      await expect(
        dispatcher.execute({
          userId: 'user-1',
          externalId: 'chat-1',
          channel: 'telegram',
          conversationState: current,
          expected: stateExpected,
          decision: { action: 'cancel_current_flow' },
          provenance: { kind: 'semantic_proposal', sourceMessageId: 'message-1' },
        }),
      ).resolves.toEqual({ status: 'cancelled' });

      expect(cancelExpenseRegistration.execute).toHaveBeenCalledWith({
        userId: 'user-1',
        chatId: 'chat-1',
        currentState,
        source: 'semantic',
        channel: 'telegram',
        expected: stateExpected,
      });
      expect(undoLastExpense.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['EXPENSE_RECEIVING', null],
    ['EXPENSE_CLARIFYING', { malformed: true }],
    [
      'EXPENSE_REVIEW',
      { ...review, reviewBinding: { ...review.reviewBinding, presentedAt: null } },
    ],
    ['EXPENSE_CORRECTING', { malformed: true }],
  ] as const)(
    'rejects malformed %s context without cancellation or queue advancement',
    async (currentState, payload) => {
      const current = state(currentState, payload);
      snapshotValidator.execute.mockResolvedValue({ status: 'current', state: current });

      await expect(
        dispatcher.execute({
          userId: 'user-1',
          externalId: 'chat-1',
          channel: 'telegram',
          conversationState: current,
          expected: { ...expected, currentState },
          decision: { action: 'cancel_current_flow' },
          provenance: { kind: 'semantic_proposal', sourceMessageId: 'message-1' },
        }),
      ).resolves.toEqual({ status: 'clarification_required', reason: 'invalid_state_context' });

      expect(cancelExpenseRegistration.execute).not.toHaveBeenCalled();
    },
  );

  it.each(['stale', 'expired', 'operation_in_progress'] as const)(
    'rejects a %s snapshot before any control dependency',
    async (status) => {
      const current = state('EXPENSE_RECEIVING', { raw_message: 'Taxi 12 EUR' });
      snapshotValidator.execute.mockResolvedValue({ status });

      await expect(
        dispatcher.execute({
          userId: 'user-1',
          externalId: 'chat-1',
          channel: 'telegram',
          conversationState: current,
          expected,
          decision: { action: 'cancel_current_flow' },
          provenance: { kind: 'semantic_proposal', sourceMessageId: 'message-1' },
        }),
      ).resolves.toEqual({ status: 'clarification_required', reason: 'stale_context' });
      expect(cancelExpenseRegistration.execute).not.toHaveBeenCalled();
      expect(undoLastExpense.execute).not.toHaveBeenCalled();
    },
  );

  it('turns inferred undo into a bound confirmation even when IDLE has immediate eligibility', async () => {
    const current = state('IDLE', { immediateUndoExpenseId: 'expense-1' });
    snapshotValidator.execute.mockResolvedValue({ status: 'current', state: current });
    undoLastExpense.execute.mockResolvedValue({
      status: 'confirmation_required',
      expense: {
        id: 'expense-1',
        concepto: 'Café',
        monto: 4.5,
        moneda: 'EUR',
        savedAt: new Date('2026-09-19T09:55:00.000Z'),
      },
    });
    presentUndoConfirmation.execute.mockResolvedValue({
      status: 'presented',
      pendingExpenseId: 'expense-1',
    });
    const idleExpected = { revision: '5', currentState: 'IDLE', expiry: 'unexpired' as const };

    await expect(
      dispatcher.execute({
        userId: 'user-1',
        externalId: 'chat-1',
        channel: 'telegram',
        conversationState: current,
        expected: idleExpected,
        decision: { action: 'undo_last_expense' },
        provenance: { kind: 'semantic_proposal', sourceMessageId: 'message-1' },
      }),
    ).resolves.toEqual({ status: 'undo_confirmation_presented', pendingExpenseId: 'expense-1' });

    expect(undoLastExpense.execute).toHaveBeenCalledWith({
      userId: 'user-1',
      action: 'request',
      provenance: 'semantic_request',
    });
    expect(presentUndoConfirmation.execute).toHaveBeenCalledWith(
      expect.objectContaining({ expected: idleExpected }),
    );
    expect(cancelExpenseRegistration.execute).not.toHaveBeenCalled();
  });
});
