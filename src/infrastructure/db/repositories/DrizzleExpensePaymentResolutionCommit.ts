import { and, eq, gt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';
import { conversationStates, spreadsheetConfigs, userPaymentMethods } from '../schema';
import type { ExpensePaymentResolutionCommit } from '../../../application/ports/ExpensePaymentResolutionCommit';
import { PaymentMethodCatalog } from '../../../domain/entities/PaymentMethodCatalog';
import { FSM_STATES, type ConversationState } from '../../../domain/entities/ConversationState';
import { normalizeExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';

class StalePaymentResolution extends Error {}
class InvalidPaymentResolution extends Error {}

export class DrizzleExpensePaymentResolutionCommit implements ExpensePaymentResolutionCommit {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async execute(
    input: Parameters<ExpensePaymentResolutionCommit['execute']>[0],
  ): ReturnType<ExpensePaymentResolutionCommit['execute']> {
    if (input.expected.currentState !== 'EXPENSE_REVIEW' || input.expected.expiry !== 'unexpired')
      return { status: 'stale' };
    try {
      const state = await this.db.transaction(async (tx): Promise<ConversationState> => {
        const [state] = await tx
          .select()
          .from(conversationStates)
          .where(eq(conversationStates.userId, input.userId))
          .for('update');
        if (
          !state ||
          state.currentState !== 'EXPENSE_REVIEW' ||
          state.revision.toString() !== input.expected.revision ||
          !state.expiresAt ||
          state.expiresAt.getTime() <= Date.now()
        )
          throw new StalePaymentResolution();
        const payload = state.statePayload as Record<string, unknown> | null;
        if (payload?.executionClaim !== undefined) throw new StalePaymentResolution();
        const current = normalizeExpenseReviewPayload(payload);
        if (
          JSON.stringify(current) !== JSON.stringify(input.current) ||
          input.next.reviewBinding?.presentedAt !== null ||
          input.next.reviewBinding?.revision !== (current.reviewBinding?.revision ?? 0) + 1
        )
          throw new StalePaymentResolution();
        const [config] = await tx
          .select()
          .from(spreadsheetConfigs)
          .where(
            and(eq(spreadsheetConfigs.userId, input.userId), eq(spreadsheetConfigs.isActive, true)),
          )
          .for('update');
        if (
          !config ||
          config.id !== input.sourceConfigId ||
          config.paymentMethodsConfirmedAt === null
        )
          throw new StalePaymentResolution();
        const rows = await tx
          .select()
          .from(userPaymentMethods)
          .where(eq(userPaymentMethods.spreadsheetId, config.id));
        const catalog = new PaymentMethodCatalog(
          config.id,
          rows.map((row) => ({
            id: row.id,
            name: row.displayName,
            normalizedName: row.normalizedName,
            isActive: row.isActive,
          })),
        );
        if (input.action.kind === 'select') {
          const selectedId = input.action.paymentMethodId;
          const selected = catalog.getActive().find((entry) => entry.id === selectedId);
          if (
            !selected ||
            input.next.paymentMethodSelection?.paymentMethodId !== selected.id ||
            input.next.paymentMethodSelection.canonicalName !== selected.name
          )
            throw new InvalidPaymentResolution();
        } else if (input.action.kind === 'add') {
          const addedName = input.action.name;
          if (
            current.paymentMethodSelection.status !== 'unresolved' ||
            current.paymentMethodSelection.unresolvedRaw !== input.action.name
          )
            throw new InvalidPaymentResolution();
          const existing = catalog
            .getMethods()
            .find((entry) => entry.normalizedName === addedName.trim().toLowerCase());
          if (existing?.isActive) throw new InvalidPaymentResolution();
          if (existing) {
            if (existing.id !== input.action.paymentMethodId) throw new InvalidPaymentResolution();
            await tx
              .update(userPaymentMethods)
              .set({ displayName: input.action.name, isActive: true })
              .where(eq(userPaymentMethods.id, existing.id));
          } else {
            await tx.insert(userPaymentMethods).values({
              id: input.action.paymentMethodId,
              spreadsheetId: config.id,
              displayName: input.action.name,
              normalizedName: input.action.name.trim().toLowerCase(),
              isActive: true,
            });
          }
          if (
            input.next.paymentMethodSelection?.paymentMethodId !== input.action.paymentMethodId ||
            input.next.paymentMethodSelection.canonicalName !== input.action.name
          )
            throw new InvalidPaymentResolution();
        } else if (
          input.next.paymentMethodSelection?.status !== 'none' ||
          input.next.extracted.medioPago !== null
        )
          throw new InvalidPaymentResolution();
        const [updated] = await tx
          .update(conversationStates)
          .set({
            statePayload: input.next,
            revision: sql`${conversationStates.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(conversationStates.userId, input.userId),
              eq(conversationStates.revision, BigInt(input.expected.revision)),
              eq(conversationStates.currentState, 'EXPENSE_REVIEW'),
              gt(conversationStates.expiresAt, sql`now()`),
            ),
          )
          .returning();
        if (!updated) throw new StalePaymentResolution();
        return {
          userId: updated.userId,
          revision: updated.revision.toString(),
          currentState:
            FSM_STATES.find((value) => value === updated.currentState) ?? 'EXPENSE_REVIEW',
          statePayload: updated.statePayload as Record<string, unknown> | null,
          enteredAt: updated.enteredAt,
          expiresAt: updated.expiresAt,
          updatedAt: updated.updatedAt,
        };
      });
      return { status: 'updated', state };
    } catch (error) {
      if (error instanceof StalePaymentResolution) return { status: 'stale' };
      if (error instanceof InvalidPaymentResolution) return { status: 'invalid' };
      throw error;
    }
  }
}
