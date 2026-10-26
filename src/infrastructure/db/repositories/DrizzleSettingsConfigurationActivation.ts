import { and, eq, gt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SettingsConfigurationActivation } from '../../../application/ports/SettingsConfigurationActivation';
import * as schema from '../schema';
import { normalizePaymentMethodName } from '../../../domain/entities/PaymentMethodCatalog';

class StaleSettingsConfiguration extends Error {}

export class DrizzleSettingsConfigurationActivation implements SettingsConfigurationActivation {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async execute(
    input: Parameters<SettingsConfigurationActivation['execute']>[0],
  ): Promise<'activated' | 'stale'> {
    const { candidate, expected, userId } = input;
    if (
      expected.expiry !== 'unexpired' ||
      expected.currentState !== 'SETTINGS_CATEGORIES' ||
      !Number.isInteger(candidate.headerRowIndex) ||
      candidate.headerRowIndex < 1 ||
      candidate.mappings.length === 0 ||
      candidate.categories.length === 0
    )
      return 'stale';
    try {
      await this.db.transaction(async (tx) => {
        const [state] = await tx
          .select()
          .from(schema.conversationStates)
          .where(eq(schema.conversationStates.userId, userId))
          .for('update');
        const payload = state?.statePayload as Record<string, unknown> | null;
        if (
          !state ||
          state.currentState !== 'SETTINGS_CATEGORIES' ||
          state.revision.toString() !== expected.revision ||
          !state.expiresAt ||
          state.expiresAt.getTime() <= Date.now() ||
          payload?.flowId !== candidate.flowId ||
          payload.proposalId !== candidate.proposalId ||
          payload.sourceConfigId !== candidate.sourceConfigId ||
          payload.fileId !== candidate.fileId ||
          payload.sheetName !== candidate.sheetName ||
          payload.stage !== 'payment_methods' ||
          JSON.stringify(payload.categories) !== JSON.stringify(candidate.categories) ||
          JSON.stringify(payload.mappings) !== JSON.stringify(candidate.mappings) ||
          JSON.stringify(payload.paymentMethods) !== JSON.stringify(candidate.paymentMethods) ||
          payload.executionClaim !== undefined
        )
          throw new StaleSettingsConfiguration();

        const [current] = await tx
          .select()
          .from(schema.spreadsheetConfigs)
          .where(
            and(
              eq(schema.spreadsheetConfigs.userId, userId),
              eq(schema.spreadsheetConfigs.isActive, true),
            ),
          )
          .for('update');
        if (
          !current ||
          current.id !== candidate.sourceConfigId ||
          current.provider !== candidate.provider
        )
          throw new StaleSettingsConfiguration();

        const [replacement] = await tx
          .insert(schema.spreadsheetConfigs)
          .values({
            userId,
            provider: candidate.provider,
            fileId: candidate.fileId,
            fileName: candidate.fileName,
            sheetName: candidate.sheetName,
            isActive: false,
            headerRowIndex: candidate.headerRowIndex,
            accessVerifiedAt: candidate.accessVerifiedAt,
            categoriesConfirmedAt: new Date(),
            paymentMethodsConfirmedAt: new Date(),
          })
          .returning({ id: schema.spreadsheetConfigs.id });
        if (!replacement) throw new Error('Configuration insertion failed');

        await tx.insert(schema.columnMappings).values(
          candidate.mappings.map((mapping) => ({
            spreadsheetId: replacement.id,
            gasttoField: mapping.field,
            columnIndex: mapping.columnIndex,
            columnHeader: mapping.columnHeader,
            inferred: false,
            confirmedAt: new Date(),
          })),
        );
        for (const category of candidate.categories) {
          const [parent] = await tx
            .insert(schema.userCategories)
            .values({
              spreadsheetId: replacement.id,
              rawValue: category.name,
              normalizedValue: category.name.trim().toLowerCase(),
            })
            .returning({ id: schema.userCategories.id });
          if (!parent) throw new Error('Category insertion failed');
          if (category.subcategories.length)
            await tx.insert(schema.userSubcategories).values(
              category.subcategories.map((name) => ({
                categoryId: parent.id,
                rawValue: name,
                normalizedValue: name.trim().toLowerCase(),
              })),
            );
        }
        const paymentNames = new Set<string>();
        for (const name of candidate.paymentMethods) {
          const normalized = normalizePaymentMethodName(name);
          if (!normalized || paymentNames.has(normalized)) throw new StaleSettingsConfiguration();
          paymentNames.add(normalized);
          await tx.insert(schema.userPaymentMethods).values({
            spreadsheetId: replacement.id,
            displayName: name.trim(),
            normalizedName: normalized,
          });
        }

        const [deactivated] = await tx
          .update(schema.spreadsheetConfigs)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.spreadsheetConfigs.id, current.id),
              eq(schema.spreadsheetConfigs.isActive, true),
            ),
          )
          .returning({ id: schema.spreadsheetConfigs.id });
        if (!deactivated) throw new StaleSettingsConfiguration();
        await tx
          .update(schema.spreadsheetConfigs)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(schema.spreadsheetConfigs.id, replacement.id));
        const [updated] = await tx
          .update(schema.conversationStates)
          .set({
            currentState: 'IDLE',
            statePayload: null,
            expiresAt: null,
            revision: sql`${schema.conversationStates.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.conversationStates.userId, userId),
              eq(schema.conversationStates.revision, BigInt(expected.revision)),
              eq(schema.conversationStates.currentState, 'SETTINGS_CATEGORIES'),
              gt(schema.conversationStates.expiresAt, sql`now()`),
            ),
          )
          .returning({ userId: schema.conversationStates.userId });
        if (!updated) throw new StaleSettingsConfiguration();
      });
      return 'activated';
    } catch (error) {
      if (error instanceof StaleSettingsConfiguration) return 'stale';
      throw error;
    }
  }
}
