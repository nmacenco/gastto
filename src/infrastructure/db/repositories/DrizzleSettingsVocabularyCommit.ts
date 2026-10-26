import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';
import { conversationStates, spreadsheetConfigs, userPaymentMethods } from '../schema';
import type {
  SettingsVocabularyCommit,
  PaymentSnapshot,
  VocabularySnapshot,
} from '../../../application/ports/SettingsVocabularyCommit';
import { PaymentMethodCatalog } from '../../../domain/entities/PaymentMethodCatalog';
import type { VocabularyTransaction } from './categoryVocabularyPersistence';
import {
  loadVocabularySnapshot,
  persistVocabularySnapshot,
  VocabularyIdentityConflict,
} from './categoryVocabularyPersistence';

class StaleVocabularyCommit extends Error {}

function sameSnapshot(a: VocabularySnapshot, b: VocabularySnapshot): boolean {
  if (
    !a ||
    !b ||
    !Array.isArray(a.categories) ||
    !Array.isArray(a.subcategories) ||
    !Array.isArray(b.categories) ||
    !Array.isArray(b.subcategories)
  )
    return false;
  const sort = (snapshot: VocabularySnapshot) => ({
    categories: [...snapshot.categories].sort((x, y) => x.id.localeCompare(y.id)),
    subcategories: [...snapshot.subcategories].sort((x, y) => x.id.localeCompare(y.id)),
  });
  return JSON.stringify(sort(a)) === JSON.stringify(sort(b));
}

function samePayments(a: PaymentSnapshot, b: PaymentSnapshot): boolean {
  if (
    !a ||
    !b ||
    typeof a.confirmed !== 'boolean' ||
    typeof b.confirmed !== 'boolean' ||
    !Array.isArray(a.methods) ||
    !Array.isArray(b.methods)
  )
    return false;
  return (
    a.confirmed === b.confirmed &&
    JSON.stringify([...a.methods].sort((x, y) => x.id.localeCompare(y.id))) ===
      JSON.stringify([...b.methods].sort((x, y) => x.id.localeCompare(y.id)))
  );
}

async function loadPayments(
  db: PostgresJsDatabase<typeof schema> | VocabularyTransaction,
  spreadsheetId: string,
): Promise<PaymentSnapshot> {
  const [config] = await db
    .select({ confirmedAt: spreadsheetConfigs.paymentMethodsConfirmedAt })
    .from(spreadsheetConfigs)
    .where(eq(spreadsheetConfigs.id, spreadsheetId));
  if (!config) throw new VocabularyIdentityConflict();
  const rows = await db
    .select()
    .from(userPaymentMethods)
    .where(eq(userPaymentMethods.spreadsheetId, spreadsheetId));
  return {
    confirmed: config.confirmedAt !== null,
    methods: rows.map((row) => ({
      id: row.id,
      name: row.displayName,
      normalizedName: row.normalizedName,
      isActive: row.isActive,
    })),
  };
}

async function persistPayments(
  tx: VocabularyTransaction,
  spreadsheetId: string,
  baseline: PaymentSnapshot,
  draft: PaymentSnapshot,
): Promise<void> {
  const catalog = new PaymentMethodCatalog(spreadsheetId, draft.methods);
  const oldIds = new Set(baseline.methods.map((method) => method.id));
  const draftIds = new Set(catalog.getMethods().map((method) => method.id));
  if (
    oldIds.size !== baseline.methods.length ||
    draftIds.size !== draft.methods.length ||
    [...oldIds].some((id) => !draftIds.has(id))
  )
    throw new VocabularyIdentityConflict();
  const newIds = draft.methods
    .filter((method) => !oldIds.has(method.id))
    .map((method) => method.id);
  if (
    newIds.length &&
    (
      await tx
        .select({ id: userPaymentMethods.id })
        .from(userPaymentMethods)
        .where(inArray(userPaymentMethods.id, newIds))
    ).length
  )
    throw new VocabularyIdentityConflict();
  for (const method of draft.methods) {
    if (oldIds.has(method.id))
      await tx
        .update(userPaymentMethods)
        .set({
          displayName: method.name,
          normalizedName: method.normalizedName,
          isActive: method.isActive,
        })
        .where(eq(userPaymentMethods.id, method.id));
    else
      await tx.insert(userPaymentMethods).values({
        id: method.id,
        spreadsheetId,
        displayName: method.name,
        normalizedName: method.normalizedName,
        isActive: method.isActive,
      });
  }
  await tx
    .update(spreadsheetConfigs)
    .set({ paymentMethodsConfirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(spreadsheetConfigs.id, spreadsheetId));
}

export class DrizzleSettingsVocabularyCommit implements SettingsVocabularyCommit {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  load(spreadsheetId: string): Promise<VocabularySnapshot> {
    return loadVocabularySnapshot(this.db, spreadsheetId);
  }

  loadPayments(spreadsheetId: string): Promise<PaymentSnapshot> {
    return loadPayments(this.db, spreadsheetId);
  }

  async execute(
    input: Parameters<SettingsVocabularyCommit['execute']>[0],
  ): Promise<'committed' | 'stale' | 'conflict'> {
    if (input.expected.currentState !== 'SETTINGS_MENU' || input.expected.expiry !== 'unexpired')
      return 'stale';
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
          state.currentState !== 'SETTINGS_MENU' ||
          state.revision.toString() !== input.expected.revision ||
          !state.expiresAt ||
          state.expiresAt.getTime() <= Date.now() ||
          payload?.screen !== input.kind ||
          payload.flowId !== input.flowId ||
          payload.sourceConfigId !== input.sourceConfigId ||
          payload.executionClaim !== undefined ||
          (input.kind === 'categories'
            ? !sameSnapshot(payload.baseline as VocabularySnapshot, input.baseline) ||
              !sameSnapshot(payload.draft as VocabularySnapshot, input.draft)
            : !samePayments(payload.baseline as PaymentSnapshot, input.baseline) ||
              !samePayments(payload.draft as PaymentSnapshot, input.draft))
        )
          throw new StaleVocabularyCommit();
        const [config] = await tx
          .select()
          .from(spreadsheetConfigs)
          .where(
            and(eq(spreadsheetConfigs.userId, input.userId), eq(spreadsheetConfigs.isActive, true)),
          )
          .for('update');
        if (!config || config.id !== input.sourceConfigId) throw new StaleVocabularyCommit();
        if (input.kind === 'categories') {
          const current = await loadVocabularySnapshot(tx, config.id);
          if (!sameSnapshot(current, input.baseline)) throw new VocabularyIdentityConflict();
          await persistVocabularySnapshot(tx, config.id, current, input.draft);
        } else {
          const current = await loadPayments(tx, config.id);
          if (!samePayments(current, input.baseline)) throw new VocabularyIdentityConflict();
          await persistPayments(tx, config.id, current, input.draft);
        }
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
              eq(conversationStates.currentState, 'SETTINGS_MENU'),
              gt(conversationStates.expiresAt, sql`now()`),
            ),
          )
          .returning({ userId: conversationStates.userId });
        if (!updated) throw new StaleVocabularyCommit();
      });
      return 'committed';
    } catch (error) {
      if (error instanceof StaleVocabularyCommit) return 'stale';
      if (error instanceof VocabularyIdentityConflict) return 'conflict';
      throw error;
    }
  }
}
