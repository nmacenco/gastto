import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelExpenseRegistrationUseCase } from './CancelExpenseRegistrationUseCase';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { expenseCopies } from '../../copies/expense.copies';

describe('CancelExpenseRegistrationUseCase', () => {
  const transition = vi.fn<TransitionConversationState['execute']>();
  const sendMessage = vi.fn<MessagingOutputPort['sendMessage']>();
  const useCase = new CancelExpenseRegistrationUseCase({
    transitionState: { execute: transition } as unknown as TransitionConversationState,
    messagingPort: { sendMessage },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    transition.mockResolvedValue({} as Awaited<ReturnType<TransitionConversationState['execute']>>);
    sendMessage.mockResolvedValue({ status: 'success' });
  });

  it.each([
    'EXPENSE_RECEIVING',
    'EXPENSE_CLARIFYING',
    'EXPENSE_REVIEW',
    'EXPENSE_CORRECTING',
  ] as const)('clears %s before confirming cancellation', async (currentState) => {
    await expect(
      useCase.execute({ userId: 'user-1', chatId: 'chat-1', currentState, source: 'text' }),
    ).resolves.toEqual({ status: 'cancelled' });

    expect(transition).toHaveBeenCalledWith({
      userId: 'user-1',
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
    });
    expect(sendMessage).toHaveBeenCalledWith('chat-1', expenseCopies.cancelled());
    expect(transition.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]!,
    );
  });

  it('reports that there is no pending registration from IDLE', async () => {
    await expect(
      useCase.execute({ userId: 'user-1', chatId: 'chat-1', currentState: 'IDLE', source: 'text' }),
    ).resolves.toEqual({ status: 'no_active_expense' });

    expect(transition).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('chat-1', expenseCopies.noActiveExpenseToCancel());
  });

  it('advances one queued expense only after cancellation is delivered', async () => {
    const advancePendingExpense = vi
      .fn()
      .mockResolvedValue({ status: 'advanced', pendingCount: 1 });
    const queuedUseCase = new CancelExpenseRegistrationUseCase({
      transitionState: { execute: transition } as unknown as TransitionConversationState,
      messagingPort: { sendMessage },
      advancePendingExpense: { execute: advancePendingExpense } as never,
    });

    await queuedUseCase.execute({
      userId: 'user-1',
      chatId: 'chat-1',
      currentState: 'EXPENSE_REVIEW',
      source: 'text',
      channel: 'telegram',
      completedCount: 1,
    });

    expect(advancePendingExpense).toHaveBeenCalledWith({
      userId: 'user-1',
      chatId: 'chat-1',
      channel: 'telegram',
      reason: 'cancelled',
      completedCount: 1,
    });
    expect(sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      advancePendingExpense.mock.invocationCallOrder[0]!,
    );
  });
});
