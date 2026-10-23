// LAYER: Application
// Admits an additional expense without mutating the active FSM flow.

import type { IExpenseQueueRepository } from '../../../domain/ports/repositories';

const MAX_PENDING_EXPENSES = 2;

export interface QueuePendingExpenseInput {
  userId: string;
  rawMessage: string;
  channel: 'telegram' | 'whatsapp';
}

export type QueuePendingExpenseOutcome =
  | { status: 'queued'; pendingCount: 1 | 2 }
  | { status: 'full'; pendingCount: 2 };

export class QueuePendingExpense {
  constructor(private readonly expenseQueueRepository: IExpenseQueueRepository) {}

  async execute(input: QueuePendingExpenseInput): Promise<QueuePendingExpenseOutcome> {
    const pendingCount = await this.expenseQueueRepository.countByUserId(input.userId);
    if (pendingCount >= MAX_PENDING_EXPENSES) {
      return { status: 'full', pendingCount: MAX_PENDING_EXPENSES };
    }

    await this.expenseQueueRepository.enqueue(input.userId, input.rawMessage, input.channel);
    return { status: 'queued', pendingCount: (pendingCount + 1) as 1 | 2 };
  }
}
