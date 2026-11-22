// LAYER: Infrastructure
// Durable deletion barrier and transactional account erasure.
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../schema';
import type {
  AccountCredentialStore,
  EncryptedAccountCredential,
} from '../../../application/use-cases/user/RevokeAccountCredentials';

export class DrizzleAccountDeletionRepository implements AccountCredentialStore {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async admitIdentityDelivery(
    channel: string,
    externalId: string,
    enqueue: () => Promise<unknown>,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select({ userId: schema.users.userId })
        .from(schema.messagingIdentities)
        .innerJoin(schema.users, eq(schema.messagingIdentities.userId, schema.users.userId))
        .where(
          and(
            eq(schema.messagingIdentities.channel, channel),
            eq(schema.messagingIdentities.externalId, externalId),
          ),
        )
        .for('share')
        .limit(1);
      if (!identity) return false;
      const [deleting] = await tx
        .select({ userId: schema.accountDeletionOperations.userId })
        .from(schema.accountDeletionOperations)
        .where(eq(schema.accountDeletionOperations.userId, identity.userId))
        .limit(1);
      if (deleting) return false;
      await enqueue();
      return true;
    });
  }

  async begin(userId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ userId: schema.users.userId })
        .from(schema.users)
        .where(eq(schema.users.userId, userId))
        .for('update')
        .limit(1);
      if (!owner) return false;
      await tx.insert(schema.accountDeletionOperations).values({ userId }).onConflictDoNothing();
      await tx
        .insert(schema.accountDeletionIdentities)
        .select(
          tx
            .select({
              userId: schema.messagingIdentities.userId,
              channel: schema.messagingIdentities.channel,
              externalId: schema.messagingIdentities.externalId,
            })
            .from(schema.messagingIdentities)
            .where(eq(schema.messagingIdentities.userId, userId)),
        )
        .onConflictDoNothing();
      return true;
    });
  }

  async confirm(input: {
    userId: string;
    channel: string;
    externalId: string;
    revision: string;
  }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ userId: schema.users.userId })
        .from(schema.users)
        .innerJoin(
          schema.messagingIdentities,
          eq(schema.messagingIdentities.userId, schema.users.userId),
        )
        .where(
          and(
            eq(schema.users.userId, input.userId),
            eq(schema.messagingIdentities.channel, input.channel),
            eq(schema.messagingIdentities.externalId, input.externalId),
          ),
        )
        .for('update', { of: schema.users })
        .limit(1);
      if (!owner) return false;

      const [pending] = await tx
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
            eq(schema.conversationStates.revision, BigInt(input.revision)),
            eq(schema.conversationStates.currentState, 'SETTINGS_MENU'),
            sql`${schema.conversationStates.statePayload}->>'screen' = 'account_deletion'`,
            sql`${schema.conversationStates.expiresAt} > now()`,
          ),
        )
        .returning({ userId: schema.conversationStates.userId });
      if (!pending) return false;

      await tx.insert(schema.accountDeletionOperations).values({ userId: input.userId });
      await tx.insert(schema.accountDeletionIdentities).select(
        tx
          .select({
            userId: schema.messagingIdentities.userId,
            channel: schema.messagingIdentities.channel,
            externalId: schema.messagingIdentities.externalId,
          })
          .from(schema.messagingIdentities)
          .where(eq(schema.messagingIdentities.userId, input.userId)),
      );
      return true;
    });
  }

  async isDeleting(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: schema.accountDeletionOperations.userId })
      .from(schema.accountDeletionOperations)
      .where(eq(schema.accountDeletionOperations.userId, userId))
      .limit(1);
    return Boolean(row);
  }

  async isIdentityDeleting(channel: string, externalId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: schema.accountDeletionIdentities.userId })
      .from(schema.accountDeletionIdentities)
      .where(
        sql`${schema.accountDeletionIdentities.channel} = ${channel} AND ${schema.accountDeletionIdentities.externalId} = ${externalId}`,
      )
      .limit(1);
    return Boolean(row);
  }

  async get(userId: string): Promise<typeof schema.accountDeletionOperations.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.accountDeletionOperations)
      .where(eq(schema.accountDeletionOperations.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async assertWorkDrained(userId: string): Promise<void> {
    const [owner] = await this.db
      .select({ activeExternalWorkCount: schema.users.activeExternalWorkCount })
      .from(schema.users)
      .where(eq(schema.users.userId, userId))
      .limit(1);
    if (owner && owner.activeExternalWorkCount > 0) {
      throw new Error('ACCOUNT_EXTERNAL_WORK_STILL_ACTIVE');
    }
  }

  async listPending(): Promise<string[]> {
    const rows = await this.db
      .select({ userId: schema.accountDeletionOperations.userId })
      .from(schema.accountDeletionOperations);
    return rows.map((row) => row.userId);
  }

  async identities(userId: string): Promise<Array<{ channel: string; externalId: string }>> {
    return this.db
      .select({
        channel: schema.accountDeletionIdentities.channel,
        externalId: schema.accountDeletionIdentities.externalId,
      })
      .from(schema.accountDeletionIdentities)
      .where(eq(schema.accountDeletionIdentities.userId, userId));
  }

  async setStage(
    userId: string,
    stage: 'revoking' | 'cleaning' | 'notifying',
    remoteRevocationFailed?: boolean,
  ): Promise<void> {
    await this.db
      .update(schema.accountDeletionOperations)
      .set({
        stage,
        updatedAt: new Date(),
        ...(remoteRevocationFailed === undefined ? {} : { remoteRevocationFailed }),
      })
      .where(eq(schema.accountDeletionOperations.userId, userId));
  }

  async finish(userId: string): Promise<void> {
    await this.db
      .delete(schema.accountDeletionOperations)
      .where(eq(schema.accountDeletionOperations.userId, userId));
  }

  async eraseAccount(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Inserts into user-owned tables take a foreign-key share lock on this row.
      // Hold the conflicting lock through expense and account deletion so a
      // concurrent insert cannot appear between those two statements.
      const [owner] = await tx
        .select({
          userId: schema.users.userId,
          activeExternalWorkCount: schema.users.activeExternalWorkCount,
        })
        .from(schema.users)
        .where(eq(schema.users.userId, userId))
        .for('update')
        .limit(1);
      if (!owner) return;
      if (owner.activeExternalWorkCount > 0) {
        throw new Error('ACCOUNT_EXTERNAL_WORK_STILL_ACTIVE');
      }
      await tx.delete(schema.expenseRecords).where(eq(schema.expenseRecords.userId, userId));
      await tx.delete(schema.users).where(eq(schema.users.userId, userId));
    });
  }

  async list(userId: string): Promise<EncryptedAccountCredential[]> {
    const [active, candidates] = await Promise.all([
      this.db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.userId, userId)),
      this.db
        .select()
        .from(schema.candidateOAuthTokens)
        .where(eq(schema.candidateOAuthTokens.userId, userId)),
    ]);
    return [
      ...active.map((row) => ({
        provider: row.provider as 'google' | 'microsoft',
        refreshTokenEnc: row.refreshTokenEnc,
        refreshIv: row.refreshIv,
      })),
      ...candidates.map((row) => ({
        provider: 'google' as const,
        refreshTokenEnc: row.refreshTokenEnc,
        refreshIv: row.refreshIv,
      })),
    ];
  }

  async deleteAll(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.candidateOAuthTokens)
        .where(eq(schema.candidateOAuthTokens.userId, userId));
      await tx.delete(schema.oauthTokens).where(eq(schema.oauthTokens.userId, userId));
    });
  }
}
