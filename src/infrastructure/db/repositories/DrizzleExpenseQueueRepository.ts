// LAYER: Infrastructure
// Durable FIFO queue for expense messages that arrive during an active flow.

import { asc, count, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { expenseQueue } from '../schema';
import type * as schema from '../schema';
import type { ExpenseQueueItem } from '../../../domain/entities/ConversationState';
import type { IExpenseQueueRepository } from '../../../domain/ports/repositories';

const MAX_PENDING_EXPENSES = 2;

export class DrizzleExpenseQueueRepository implements IExpenseQueueRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findByUserId(userId: string): Promise<ExpenseQueueItem[]> {
    const rows = await this.db
      .select()
      .from(expenseQueue)
      .where(eq(expenseQueue.userId, userId))
      .orderBy(asc(expenseQueue.position));

    return rows.map((row) => this.mapQueueItem(row));
  }

  async enqueue(
    userId: string,
    rawMessage: string,
    channel: 'telegram' | 'whatsapp',
  ): Promise<ExpenseQueueItem> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ position: expenseQueue.position })
        .from(expenseQueue)
        .where(eq(expenseQueue.userId, userId))
        .orderBy(asc(expenseQueue.position));

      if (rows.length >= MAX_PENDING_EXPENSES) {
        throw new Error('Expense queue is full');
      }

      const [row] = await tx
        .insert(expenseQueue)
        .values({ userId, rawMessage, channel, position: rows.length + 1 })
        .returning();

      if (!row) throw new Error('Failed to enqueue pending expense');
      return this.mapQueueItem(row);
    });
  }

  async dequeueFirst(userId: string): Promise<ExpenseQueueItem | null> {
    return this.db.transaction(async (tx) => {
      const [first] = await tx
        .select()
        .from(expenseQueue)
        .where(eq(expenseQueue.userId, userId))
        .orderBy(asc(expenseQueue.position))
        .limit(1);

      if (!first) return null;

      await tx.delete(expenseQueue).where(eq(expenseQueue.id, first.id));
      await tx
        .update(expenseQueue)
        .set({ position: sql`${expenseQueue.position} - 1` })
        .where(eq(expenseQueue.userId, userId));

      return this.mapQueueItem(first);
    });
  }

  async countByUserId(userId: string): Promise<number> {
    const [result] = await this.db
      .select({ value: count() })
      .from(expenseQueue)
      .where(eq(expenseQueue.userId, userId));

    return Number(result?.value ?? 0);
  }

  async clearByUserId(userId: string): Promise<void> {
    await this.db.delete(expenseQueue).where(eq(expenseQueue.userId, userId));
  }

  private mapQueueItem(row: typeof expenseQueue.$inferSelect): ExpenseQueueItem {
    return {
      id: row.id,
      userId: row.userId,
      position: row.position as ExpenseQueueItem['position'],
      rawMessage: row.rawMessage,
      receivedAt: row.receivedAt,
      channel: row.channel as ExpenseQueueItem['channel'],
    };
  }
}
