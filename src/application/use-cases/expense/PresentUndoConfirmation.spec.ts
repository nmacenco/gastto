import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { PresentUndoConfirmation } from './PresentUndoConfirmation';

const baseState: ConversationState = {
  userId: 'user-1',
  revision: '8',
  currentState: 'EXPENSE_UNDO_CONFIRMING',
  statePayload: null,
  enteredAt: new Date('2026-09-19T10:00:00.000Z'),
  expiresAt: new Date('2026-09-19T10:05:00.000Z'),
  updatedAt: new Date('2026-09-19T10:00:00.000Z'),
};

describe('PresentUndoConfirmation', () => {
  const transition = vi.fn<TransitionConversationState['execute']>();
  const sendMessage = vi.fn();
  const presenter = new PresentUndoConfirmation({
    transitionState: { execute: transition },
    messagingPort: { sendMessage },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    transition
      .mockResolvedValueOnce({ status: 'updated', state: baseState })
      .mockResolvedValueOnce({ status: 'updated', state: { ...baseState, revision: '9' } });
    sendMessage.mockResolvedValue({ status: 'success' });
  });

  it('persists an unpresented binding before delivery and binds it only after success', async () => {
    const outcome = await presenter.execute({
      userId: 'user-1',
      chatId: 'chat-1',
      expense: {
        id: 'expense-1',
        concepto: 'Café',
        monto: 4.5,
        moneda: 'EUR',
        savedAt: new Date('2026-09-19T09:55:00.000Z'),
      },
      expected: { revision: '7', currentState: 'IDLE', expiry: 'unexpired' },
    });

    expect(outcome).toEqual({ status: 'presented', pendingExpenseId: 'expense-1' });
    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition.mock.calls[0]?.[0]).toMatchObject({
      targetState: 'EXPENSE_UNDO_CONFIRMING',
      payload: {
        pendingExpenseId: 'expense-1',
        actionBinding: { revision: 1, presentedAt: null },
      },
      expected: { revision: '7', currentState: 'IDLE', expiry: 'unexpired' },
    });
    expect(transition.mock.calls[1]?.[0]).toMatchObject({
      expected: { revision: '8', currentState: 'EXPENSE_UNDO_CONFIRMING', expiry: 'unexpired' },
      payload: { pendingExpenseId: 'expense-1' },
    });
    expect(JSON.stringify(transition.mock.calls[1]?.[0].payload)).toMatch(/"presentedAt":"[^"]+"/);
    expect(transition.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]!,
    );
    expect(sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      transition.mock.invocationCallOrder[1]!,
    );
  });

  it('leaves a failed delivery unbound', async () => {
    sendMessage.mockResolvedValue({ status: 'failure', errorCode: 'SEND_FAILED' });

    await expect(
      presenter.execute({
        userId: 'user-1',
        chatId: 'chat-1',
        expense: {
          id: 'expense-1',
          concepto: 'Café',
          monto: 4.5,
          moneda: 'EUR',
          savedAt: new Date('2026-09-19T09:55:00.000Z'),
        },
        expected: { revision: '7', currentState: 'IDLE', expiry: 'unexpired' },
      }),
    ).resolves.toEqual({ status: 'unbound', pendingExpenseId: 'expense-1' });

    expect(transition).toHaveBeenCalledOnce();
    expect(JSON.stringify(transition.mock.calls[0]?.[0].payload)).toContain('"presentedAt":null');
  });
});
