// LAYER: Application
// Advances exactly one queued expense after its active predecessor resolves.

import { expenseCopies } from '../../copies/expense.copies';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { ExpenseSummaryPresenter } from '../../ports/output/expense-summary.presenter';
import type { IExpenseQueueRepository } from '../../../domain/ports/repositories';
import type { GenerateExpenseSummaryUseCase } from './GenerateExpenseSummaryUseCase';
import type { RegisterExpenseUseCase } from './RegisterExpense';

export interface AdvancePendingExpenseInput {
  userId: string;
  chatId: string;
  channel: 'telegram' | 'whatsapp';
  reason: 'confirmed' | 'cancelled' | 'expired';
  completedCount: number;
  immediateUndoExpenseId?: string;
}

export type AdvancePendingExpenseOutcome =
  | { status: 'advanced'; pendingCount: 1 | 2 }
  | { status: 'empty' };

export interface AdvancePendingExpenseDeps {
  expenseQueueRepository: IExpenseQueueRepository;
  registerExpense: RegisterExpenseUseCase;
  generateExpenseSummary: GenerateExpenseSummaryUseCase;
  messagingPort: MessagingOutputPort;
  expenseSummaryPresenterFactory: (
    messaging: MessagingOutputPort,
    chatId: string,
  ) => ExpenseSummaryPresenter;
}

export class AdvancePendingExpense {
  constructor(private readonly deps: AdvancePendingExpenseDeps) {}

  async execute(input: AdvancePendingExpenseInput): Promise<AdvancePendingExpenseOutcome> {
    const [queuedExpense] = await this.deps.expenseQueueRepository.findByUserId(input.userId);
    if (!queuedExpense) return { status: 'empty' };

    const remainingCount = await this.deps.expenseQueueRepository.countByUserId(input.userId);
    const pendingCount = (remainingCount + 1) as 1 | 2;
    await this.deps.messagingPort.sendMessage(
      input.chatId,
      input.reason === 'expired'
        ? expenseCopies.expenseQueueExpirationAdvance()
        : expenseCopies.expenseQueueNotice(pendingCount),
    );

    const interpretation = await this.deps.registerExpense.interpret({
      userId: input.userId,
      rawMessage: queuedExpense.rawMessage,
      channel: input.channel,
      queueRegisteredCount: input.completedCount,
      ...(input.immediateUndoExpenseId === undefined
        ? {}
        : { immediateUndoExpenseId: input.immediateUndoExpenseId }),
    });

    if (interpretation.status === 'needs_clarification') {
      await this.deps.messagingPort.sendMessage(
        input.chatId,
        interpretation.missingField === 'monto'
          ? expenseCopies.clarificationAmount()
          : expenseCopies.clarificationCurrency(),
      );
    } else if (interpretation.status === 'needs_zero_confirmation') {
      await this.deps.messagingPort.sendMessage(
        input.chatId,
        expenseCopies.zeroAmountConfirmation(),
      );
    } else {
      const presenter = this.deps.expenseSummaryPresenterFactory(
        this.deps.messagingPort,
        input.chatId,
      );
      await this.deps.generateExpenseSummary.execute({
        userId: input.userId,
        payload: interpretation.payload,
        presenter,
      });
    }

    // Remove only after the next active flow has been persisted and presented.
    // If interpretation or presentation fails, the FIFO item remains durable for retry.
    await this.deps.expenseQueueRepository.dequeueFirst(input.userId);

    return { status: 'advanced', pendingCount };
  }
}
