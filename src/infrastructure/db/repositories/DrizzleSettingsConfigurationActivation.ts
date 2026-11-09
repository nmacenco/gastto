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
          payload.accountChangeRequestId !== candidate.accountChangeRequestId ||
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

        let accountChange: typeof schema.accessRequests.$inferSelect | null = null;
        let candidateToken: typeof schema.candidateOAuthTokens.$inferSelect | null = null;
        if (candidate.accountChangeRequestId) {
          const [request] = await tx
            .select()
            .from(schema.accessRequests)
            .where(eq(schema.accessRequests.id, candidate.accountChangeRequestId))
            .for('update');
          const [token] = await tx
            .select()
            .from(schema.candidateOAuthTokens)
            .where(eq(schema.candidateOAuthTokens.requestId, candidate.accountChangeRequestId))
            .for('update');
          if (
            !request ||
            request.userId !== userId ||
            request.kind !== 'replacement' ||
            request.status !== 'approved' ||
            request.activatedAt !== null ||
            !token ||
            token.userId !== userId ||
            token.revokedAt !== null ||
            token.accessTokenExpiresAt.getTime() <= Date.now()
          ) {
            throw new StaleSettingsConfiguration();
          }
          accountChange = request;
          candidateToken = token;
        }

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
        if (accountChange && candidateToken) {
          await tx
            .update(schema.accessRequests)
            .set({ status: 'superseded' })
            .where(
              and(
                eq(schema.accessRequests.userId, userId),
                eq(schema.accessRequests.status, 'approved'),
                sql`${schema.accessRequests.activatedAt} IS NOT NULL`,
              ),
            );
          const [promoted] = await tx
            .update(schema.accessRequests)
            .set({ activatedAt: new Date() })
            .where(
              and(
                eq(schema.accessRequests.id, accountChange.id),
                eq(schema.accessRequests.status, 'approved'),
              ),
            )
            .returning({ id: schema.accessRequests.id });
          if (!promoted) throw new StaleSettingsConfiguration();
          await tx
            .insert(schema.oauthTokens)
            .values({
              userId,
              provider: 'google',
              accessTokenEnc: candidateToken.accessTokenEnc,
              refreshTokenEnc: candidateToken.refreshTokenEnc,
              iv: candidateToken.iv,
              refreshIv: candidateToken.refreshIv,
              accessTokenExpiresAt: candidateToken.accessTokenExpiresAt,
              scope: candidateToken.scope,
              grantedAt: candidateToken.grantedAt,
              lastRefreshedAt: candidateToken.lastRefreshedAt,
              revokedAt: null,
            })
            .onConflictDoUpdate({
              target: [schema.oauthTokens.userId, schema.oauthTokens.provider],
              set: {
                accessTokenEnc: candidateToken.accessTokenEnc,
                refreshTokenEnc: candidateToken.refreshTokenEnc,
                iv: candidateToken.iv,
                refreshIv: candidateToken.refreshIv,
                accessTokenExpiresAt: candidateToken.accessTokenExpiresAt,
                scope: candidateToken.scope,
                grantedAt: candidateToken.grantedAt,
                lastRefreshedAt: candidateToken.lastRefreshedAt,
                revokedAt: null,
              },
            });
          await tx
            .delete(schema.candidateOAuthTokens)
            .where(eq(schema.candidateOAuthTokens.requestId, accountChange.id));
        }
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
