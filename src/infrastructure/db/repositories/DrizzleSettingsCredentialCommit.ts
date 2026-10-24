import { and, eq, gt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  SettingsCredentialCommit,
  SettingsCredentialCommitInput,
} from '../../../application/ports/SettingsCredentialCommit';
import * as schema from '../schema';

class StaleSettingsFlow extends Error {}

export class DrizzleSettingsCredentialCommit implements SettingsCredentialCommit {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async execute(input: SettingsCredentialCommitInput): Promise<'committed' | 'stale'> {
    try {
      await this.db.transaction(async (tx) => {
        const [state] = await tx
          .select()
          .from(schema.conversationStates)
          .where(eq(schema.conversationStates.userId, input.userId))
          .for('update');
        if (
          !state ||
          input.expected.currentState !== 'SETTINGS_OAUTH' ||
          input.expected.expiry !== 'unexpired' ||
          state.currentState !== 'SETTINGS_OAUTH' ||
          state.revision.toString() !== input.expected.revision ||
          !state.expiresAt ||
          state.expiresAt.getTime() <= Date.now() ||
          (state.statePayload as Record<string, unknown> | null)?.flowId !== input.flowId ||
          (state.statePayload as Record<string, unknown> | null)?.state !== input.nonce ||
          (state.statePayload as Record<string, unknown> | null)?.executionClaim !== undefined
        )
          throw new StaleSettingsFlow();

        const [config] = await tx
          .select()
          .from(schema.spreadsheetConfigs)
          .where(
            and(
              eq(schema.spreadsheetConfigs.id, input.sourceConfigId),
              eq(schema.spreadsheetConfigs.userId, input.userId),
            ),
          )
          .for('update');
        if (
          !config ||
          !config.isActive ||
          config.provider !== 'google' ||
          config.fileId !== input.fileId ||
          config.sheetName !== input.sheetName
        ) {
          throw new StaleSettingsFlow();
        }

        const credential = input.credential;
        await tx
          .insert(schema.oauthTokens)
          .values({
            userId: input.userId,
            provider: 'google',
            accessTokenEnc: credential.accessTokenEnc,
            refreshTokenEnc: credential.refreshTokenEnc,
            iv: credential.iv,
            refreshIv: credential.refreshIv,
            accessTokenExpiresAt: credential.accessTokenExpiresAt,
            scope: credential.scope,
            grantedAt: credential.grantedAt,
            lastRefreshedAt: credential.lastRefreshedAt,
            revokedAt: null,
          })
          .onConflictDoUpdate({
            target: [schema.oauthTokens.userId, schema.oauthTokens.provider],
            set: {
              accessTokenEnc: credential.accessTokenEnc,
              refreshTokenEnc: credential.refreshTokenEnc,
              iv: credential.iv,
              refreshIv: credential.refreshIv,
              accessTokenExpiresAt: credential.accessTokenExpiresAt,
              scope: credential.scope,
              grantedAt: credential.grantedAt,
              lastRefreshedAt: null,
              revokedAt: null,
            },
          });

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
              eq(schema.conversationStates.userId, input.userId),
              eq(schema.conversationStates.currentState, 'SETTINGS_OAUTH'),
              eq(schema.conversationStates.revision, BigInt(input.expected.revision)),
              gt(schema.conversationStates.expiresAt, sql`now()`),
            ),
          )
          .returning({ userId: schema.conversationStates.userId });
        if (!updated) throw new StaleSettingsFlow();
      });
      return 'committed';
    } catch (error) {
      if (error instanceof StaleSettingsFlow) return 'stale';
      throw error;
    }
  }
}
