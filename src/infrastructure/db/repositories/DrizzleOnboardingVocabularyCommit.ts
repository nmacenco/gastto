import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';
import { conversationStates, spreadsheetConfigs, userPaymentMethods, users } from '../schema';
import type { OnboardingVocabularyCommit } from '../../../application/ports/OnboardingVocabularyCommit';
import type { VocabularySnapshot } from '../../../application/ports/SettingsVocabularyCommit';
import { normalizePaymentMethodName } from '../../../domain/entities/PaymentMethodCatalog';
import {
  loadVocabularySnapshot,
  persistVocabularySnapshot,
  VocabularyIdentityConflict,
} from './categoryVocabularyPersistence';

class StaleOnboardingCommit extends Error {}

export class DrizzleOnboardingVocabularyCommit implements OnboardingVocabularyCommit {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async execute(
    input: Parameters<OnboardingVocabularyCommit['execute']>[0],
  ): Promise<'committed' | 'stale' | 'conflict'> {
    if (input.expected.currentState !== 'ONBOARDING_CATEGORIES') return 'stale';
    try {
      await this.db.transaction(async (tx) => {
        const [state] = await tx
          .select()
          .from(conversationStates)
          .where(eq(conversationStates.userId, input.userId))
          .for('update');
        const payload = state?.statePayload as Record<string, unknown> | null;
        if (
          !state ||
          state.currentState !== 'ONBOARDING_CATEGORIES' ||
          state.revision.toString() !== input.expected.revision ||
          (state.expiresAt !== null && state.expiresAt.getTime() <= Date.now()) ||
          payload?.paymentReview !== true ||
          JSON.stringify(payload.categories) !== JSON.stringify(input.categories) ||
          JSON.stringify(payload.paymentMethods) !== JSON.stringify(input.paymentMethods) ||
          JSON.stringify(payload.categoryDraft) !== JSON.stringify(input.categoryDraft) ||
          payload.executionClaim !== undefined
        )
          throw new StaleOnboardingCommit();
        const [config] = await tx
          .select()
          .from(spreadsheetConfigs)
          .where(
            and(eq(spreadsheetConfigs.userId, input.userId), eq(spreadsheetConfigs.isActive, true)),
          )
          .for('update');
        if (!config || config.id !== input.sourceConfigId) throw new StaleOnboardingCommit();
        const baseline = await loadVocabularySnapshot(tx, config.id);
        const draft = input.categoryDraft
          ? buildIdentifiedDraft(baseline, input.categories, input.categoryDraft)
          : buildDraft(baseline, input.categories);
        await persistVocabularySnapshot(tx, config.id, baseline, draft);
        const existingPayments = await tx
          .select()
          .from(userPaymentMethods)
          .where(eq(userPaymentMethods.spreadsheetId, config.id));
        const names = new Set<string>();
        for (const name of input.paymentMethods) {
          const normalized = normalizePaymentMethodName(name);
          if (!normalized || names.has(normalized)) throw new VocabularyIdentityConflict();
          names.add(normalized);
          const existing = existingPayments.find((row) => row.normalizedName === normalized);
          if (existing)
            await tx
              .update(userPaymentMethods)
              .set({ displayName: name.trim(), isActive: true })
              .where(eq(userPaymentMethods.id, existing.id));
          else
            await tx.insert(userPaymentMethods).values({
              spreadsheetId: config.id,
              displayName: name.trim(),
              normalizedName: normalized,
            });
        }
        for (const row of existingPayments)
          if (!names.has(row.normalizedName))
            await tx
              .update(userPaymentMethods)
              .set({ isActive: false })
              .where(eq(userPaymentMethods.id, row.id));
        await tx
          .update(spreadsheetConfigs)
          .set({
            categoriesConfirmedAt: config.categoriesConfirmedAt ?? new Date(),
            paymentMethodsConfirmedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(spreadsheetConfigs.id, config.id));
        await tx
          .update(users)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(users.userId, input.userId));
        const [updated] = await tx
          .update(conversationStates)
          .set({
            currentState: 'IDLE',
            statePayload: null,
            expiresAt: null,
            revision: sql`${conversationStates.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(conversationStates.userId, input.userId),
              eq(conversationStates.revision, BigInt(input.expected.revision)),
              eq(conversationStates.currentState, 'ONBOARDING_CATEGORIES'),
            ),
          )
          .returning({ userId: conversationStates.userId });
        if (!updated) throw new StaleOnboardingCommit();
      });
      return 'committed';
    } catch (error) {
      if (error instanceof StaleOnboardingCommit) return 'stale';
      if (error instanceof VocabularyIdentityConflict) return 'conflict';
      throw error;
    }
  }
}

function buildDraft(
  baseline: VocabularySnapshot,
  categories: Parameters<OnboardingVocabularyCommit['execute']>[0]['categories'],
): VocabularySnapshot {
  const draft: VocabularySnapshot = {
    categories: baseline.categories.map((row) => ({ ...row, isActive: false })),
    subcategories: baseline.subcategories.map((row) => ({ ...row, isActive: false })),
  };
  const parentNames = new Set<string>();
  for (const node of categories) {
    const name = node.name.trim();
    const normalizedName = name.toLowerCase();
    if (!normalizedName || parentNames.has(normalizedName)) throw new VocabularyIdentityConflict();
    parentNames.add(normalizedName);
    let parent = draft.categories.find((row) => row.normalizedName === normalizedName);
    if (!parent) {
      parent = { id: randomUUID(), name, normalizedName, isActive: true };
      draft.categories.push(parent);
    }
    parent.name = name;
    parent.isActive = true;
    const childNames = new Set<string>();
    for (const rawChild of node.subcategories) {
      const childName = rawChild.trim();
      const key = childName.toLowerCase();
      if (!key || childNames.has(key)) throw new VocabularyIdentityConflict();
      childNames.add(key);
      let child = draft.subcategories.find(
        (row) => row.categoryId === parent.id && row.normalizedName === key,
      );
      if (!child) {
        child = {
          id: randomUUID(),
          categoryId: parent.id,
          name: childName,
          normalizedName: key,
          isActive: true,
        };
        draft.subcategories.push(child);
      }
      child.name = childName;
      child.isActive = true;
    }
  }
  return draft;
}

function buildIdentifiedDraft(
  baseline: VocabularySnapshot,
  categories: Parameters<OnboardingVocabularyCommit['execute']>[0]['categories'],
  identified: NonNullable<Parameters<OnboardingVocabularyCommit['execute']>[0]['categoryDraft']>,
): VocabularySnapshot {
  const active = identified.categories.map((row) => ({ ...row, isActive: true }));
  const children = identified.subcategories.map((row) => ({ ...row, isActive: true }));
  const displayed = active.map((parent) => ({
    name: parent.name,
    subcategories: children
      .filter((child) => child.categoryId === parent.id)
      .map((child) => child.name),
  }));
  if (JSON.stringify(displayed) !== JSON.stringify(categories))
    throw new VocabularyIdentityConflict();
  const activeIds = new Set(active.map((row) => row.id));
  const childIds = new Set(children.map((row) => row.id));
  return {
    categories: [
      ...baseline.categories
        .filter((row) => !activeIds.has(row.id))
        .map((row) => ({ ...row, isActive: false })),
      ...active,
    ],
    subcategories: [
      ...baseline.subcategories
        .filter((row) => !childIds.has(row.id))
        .map((row) => ({ ...row, isActive: false })),
      ...children,
    ],
  };
}
