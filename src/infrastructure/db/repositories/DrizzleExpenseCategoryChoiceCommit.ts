import { isDeepStrictEqual } from 'node:util';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';
import { conversationStates, spreadsheetConfigs } from '../schema';
import type { ExpenseCategoryChoiceCommit } from '../../../application/ports/ExpenseCategoryChoiceCommit';
import { parseExpenseCategoryChoice } from '../../../application/use-cases/expense/ExpenseCategoryChoiceState';
import { normalizeExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { FSM_STATES, type ConversationState } from '../../../domain/entities/ConversationState';
import {
  loadVocabularySnapshot,
  persistVocabularySnapshot,
  VocabularyIdentityConflict,
} from './categoryVocabularyPersistence';
import { sameSnapshot } from './DrizzleSettingsVocabularyCommit';

class StaleChoice extends Error {}
class ConflictingChoice extends Error {}

export class DrizzleExpenseCategoryChoiceCommit implements ExpenseCategoryChoiceCommit {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  load(spreadsheetId: string) {
    return loadVocabularySnapshot(this.db, spreadsheetId);
  }

  async execute(
    input: Parameters<ExpenseCategoryChoiceCommit['execute']>[0],
  ): ReturnType<ExpenseCategoryChoiceCommit['execute']> {
    if (
      input.expected.currentState !== 'EXPENSE_CORRECTING' ||
      input.expected.expiry !== 'unexpired'
    )
      return { status: 'stale' };
    try {
      const committed = await this.db.transaction(async (tx): Promise<ConversationState> => {
        const [state] = await tx
          .select()
          .from(conversationStates)
          .where(eq(conversationStates.userId, input.userId))
          .for('update');
        if (
          !state ||
          state.currentState !== 'EXPENSE_CORRECTING' ||
          state.revision.toString() !== input.expected.revision ||
          !state.expiresAt ||
          state.expiresAt.getTime() <= Date.now()
        )
          throw new StaleChoice();
        const stored = parseExpenseCategoryChoice(state.statePayload);
        if (
          !stored ||
          stored.choiceId !== input.choice.choiceId ||
          stored.stage !== input.choice.stage ||
          !isDeepStrictEqual(stored, parseExpenseCategoryChoice(input.choice)) ||
          (state.statePayload as Record<string, unknown> | null)?.executionClaim !== undefined
        )
          throw new StaleChoice();
        if (input.selected.add && stored.stage !== 'confirm') throw new StaleChoice();
        if (!input.selected.add && stored.stage !== 'choose') throw new StaleChoice();
        const [config] = await tx
          .select()
          .from(spreadsheetConfigs)
          .where(
            and(eq(spreadsheetConfigs.userId, input.userId), eq(spreadsheetConfigs.isActive, true)),
          )
          .for('update');
        if (!config || config.id !== stored.sourceConfigId) throw new StaleChoice();
        const current = await loadVocabularySnapshot(tx, config.id);
        if (!sameSnapshot(current, stored.baseline)) throw new ConflictingChoice();
        const normalized = input.selected.name.trim().toLowerCase();
        const existing = current.categories.find((row) => row.normalizedName === normalized);
        if (input.selected.add) {
          if (
            normalized !== stored.attemptedName.trim().toLowerCase() ||
            existing?.isActive ||
            (existing && existing.id !== input.selected.id)
          )
            throw new ConflictingChoice();
          const draft = {
            categories: existing
              ? current.categories.map((row) =>
                  row.id === existing.id ? { ...row, isActive: true } : row,
                )
              : [
                  ...current.categories,
                  {
                    id: input.selected.id,
                    name: input.selected.name.trim(),
                    normalizedName: normalized,
                    isActive: true,
                  },
                ],
            subcategories: current.subcategories,
          };
          await persistVocabularySnapshot(tx, config.id, current, draft);
        } else if (!existing?.isActive || existing.id !== input.selected.id)
          throw new ConflictingChoice();
        const next = normalizeExpenseReviewPayload(input.next);
        const priorBinding = stored.original.reviewBinding;
        if (
          next.resolvedCategoryId !== input.selected.id ||
          next.resolvedCategory !== (existing?.name ?? input.selected.name.trim()) ||
          next.categoryStatus !== 'confirmed' ||
          next.reviewBinding?.presentedAt !== null ||
          next.reviewBinding?.revision !==
            (priorBinding && priorBinding.revision !== Number.MAX_SAFE_INTEGER
              ? priorBinding.revision + 1
              : 1) ||
          (priorBinding &&
            priorBinding.revision !== Number.MAX_SAFE_INTEGER &&
            next.reviewBinding?.operationId !== priorBinding.operationId)
        )
          throw new ConflictingChoice();
        const [updated] = await tx
          .update(conversationStates)
          .set({
            currentState: 'EXPENSE_REVIEW',
            statePayload: next,
            revision: sql`${conversationStates.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(conversationStates.userId, input.userId),
              eq(conversationStates.revision, BigInt(input.expected.revision)),
              eq(conversationStates.currentState, 'EXPENSE_CORRECTING'),
              gt(conversationStates.expiresAt, sql`now()`),
            ),
          )
          .returning();
        if (!updated) throw new StaleChoice();
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
      return { status: 'updated', state: committed };
    } catch (error) {
      if (error instanceof StaleChoice) return { status: 'stale' };
      if (error instanceof ConflictingChoice || error instanceof VocabularyIdentityConflict)
        return { status: 'conflict' };
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        return { status: 'conflict' };
      throw error;
    }
  }
}
