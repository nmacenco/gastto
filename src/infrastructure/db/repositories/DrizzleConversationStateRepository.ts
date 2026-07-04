// LAYER: Infrastructure
// Concrete IConversationStateRepository implementation using Drizzle ORM.
// Maps between schema row shape and domain ConversationState entity.

import { eq, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { conversationStates } from '../schema';
import type * as schema from '../schema';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import type { ConversationState, FsmState } from '../../../domain/entities/ConversationState';

export class DrizzleConversationStateRepository implements IConversationStateRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findByUserId(userId: string): Promise<ConversationState | null> {
    const [row] = await this.db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.userId, userId))
      .limit(1);

    return row ? this.mapConversationState(row) : null;
  }

  async create(userId: string): Promise<ConversationState> {
    const [row] = await this.db
      .insert(conversationStates)
      .values({
        userId,
        currentState: 'IDLE',
        statePayload: null,
        expiresAt: null,
      })
      .returning();

    if (!row) throw new Error('Failed to create conversation state');

    return this.mapConversationState(row);
  }

  async transition(
    userId: string,
    nextState: ConversationState['currentState'],
    payload: Record<string, unknown> | null,
    expiresAt: Date | null,
  ): Promise<ConversationState> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(conversationStates)
        .set({
          currentState: nextState,
          statePayload: payload,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(conversationStates.userId, userId))
        .returning();

      if (!row) throw new Error('Failed to transition conversation state');

      return this.mapConversationState(row);
    });
  }

  async findExpired(): Promise<ConversationState[]> {
    const rows = await this.db
      .select()
      .from(conversationStates)
      .where(lte(conversationStates.expiresAt, sql`now()`));

    return rows.map((row) => this.mapConversationState(row));
  }

  // ── Mappers ────────────────────────────────────────────────────────────────

  private mapConversationState(row: typeof conversationStates.$inferSelect): ConversationState {
    return {
      userId: row.userId,
      currentState: row.currentState as FsmState,
      statePayload: (row.statePayload as Record<string, unknown> | null) ?? null,
      enteredAt: row.enteredAt,
      expiresAt: row.expiresAt ?? null,
      updatedAt: row.updatedAt,
    };
  }
}
