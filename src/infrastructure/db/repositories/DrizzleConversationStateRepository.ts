// LAYER: Infrastructure
// Concrete IConversationStateRepository implementation using Drizzle ORM.
// Maps between schema row shape and domain ConversationState entity.

import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { conversationStates } from '../schema';
import type * as schema from '../schema';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import type {
  ConversationState,
  ConversationStateWriteResult,
  FsmState,
} from '../../../domain/entities/ConversationState';
import { getFinancialExecutionClaim } from '../../../domain/entities/ConversationState';

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
      .onConflictDoNothing({ target: conversationStates.userId })
      .returning();

    if (!row) {
      const existing = await this.findByUserId(userId);
      if (existing) return existing;
      throw new Error('Failed to create conversation state');
    }

    return this.mapConversationState(row);
  }

  async transition(input: {
    userId: string;
    expected: {
      revision: string;
      currentState: string;
      expiry: 'unexpired' | 'expired' | 'any';
    };
    nextState: ConversationState['currentState'];
    payload: Record<string, unknown> | null;
    expiresAt: Date | null;
    claimId?: string;
  }): Promise<ConversationStateWriteResult> {
    const outgoingClaim = getFinancialExecutionClaim(input.payload);
    if (input.payload?.executionClaim !== undefined && !outgoingClaim) {
      throw new Error('Conversation state execution claim payload is invalid');
    }
    if (input.claimId === undefined && outgoingClaim) {
      throw new Error('Conversation state execution claims require a claimId');
    }
    if (outgoingClaim && outgoingClaim.claimId !== input.claimId) {
      throw new Error('Conversation state claimId must match the outgoing execution claim');
    }
    const currentBeforeWrite = await this.findByUserId(input.userId);
    const persistedClaimValue = currentBeforeWrite?.statePayload?.executionClaim;
    const persistedClaim = getFinancialExecutionClaim(currentBeforeWrite?.statePayload ?? null);
    if (input.claimId === undefined) {
      if (persistedClaimValue !== undefined) {
        return { status: 'operation_in_progress' };
      }
    } else if (outgoingClaim) {
      if (persistedClaimValue !== undefined && persistedClaim?.claimId !== input.claimId) {
        return { status: 'operation_in_progress' };
      }
    } else if (persistedClaim?.claimId !== input.claimId) {
      return persistedClaimValue === undefined
        ? { status: 'stale' }
        : { status: 'operation_in_progress' };
    }
    const expectedRevision = BigInt(input.expected.revision);
    const expiryPredicate =
      input.expected.expiry === 'expired'
        ? and(
            isNotNull(conversationStates.expiresAt),
            lte(conversationStates.expiresAt, sql`now()`),
          )
        : input.expected.expiry === 'unexpired'
          ? or(isNull(conversationStates.expiresAt), gt(conversationStates.expiresAt, sql`now()`))
          : undefined;
    const predicates = [
      eq(conversationStates.userId, input.userId),
      eq(conversationStates.revision, expectedRevision),
      eq(conversationStates.currentState, input.expected.currentState),
      ...(expiryPredicate ? [expiryPredicate] : []),
    ];
    const [row] = await this.db
      .update(conversationStates)
      .set({
        currentState: input.nextState,
        statePayload: input.payload,
        expiresAt: input.expiresAt,
        revision: sql`${conversationStates.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(and(...predicates))
      .returning();

    if (row) return { status: 'updated', state: this.mapConversationState(row) };

    const current = await this.findByUserId(input.userId);
    if (!current) return { status: 'missing' };
    if (
      input.expected.expiry === 'unexpired' &&
      current.expiresAt !== null &&
      current.expiresAt.getTime() <= Date.now()
    ) {
      return { status: 'expired' };
    }
    if (
      input.expected.expiry === 'expired' &&
      (current.expiresAt === null || current.expiresAt.getTime() > Date.now())
    ) {
      return { status: 'stale' };
    }
    return current.statePayload?.executionClaim !== undefined
      ? { status: 'operation_in_progress' }
      : { status: 'stale' };
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
      revision: row.revision.toString(),
      currentState: row.currentState as FsmState,
      statePayload: (row.statePayload as Record<string, unknown> | null) ?? null,
      enteredAt: row.enteredAt,
      expiresAt: row.expiresAt ?? null,
      updatedAt: row.updatedAt,
    };
  }
}
