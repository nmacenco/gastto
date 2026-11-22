import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CandidateOAuthToken,
  CandidateOAuthTokenRepository,
} from '../../../application/ports/CandidateOAuthTokenRepository';
import * as schema from '../schema';

export class DrizzleCandidateOAuthTokenRepository implements CandidateOAuthTokenRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async upsert(token: CandidateOAuthToken): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ userId: schema.users.userId })
        .from(schema.users)
        .where(eq(schema.users.userId, token.userId))
        .for('share')
        .limit(1);
      if (!owner) throw new Error('ACCOUNT_CREDENTIAL_WRITE_BLOCKED');
      const [deleting] = await tx
        .select({ userId: schema.accountDeletionOperations.userId })
        .from(schema.accountDeletionOperations)
        .where(eq(schema.accountDeletionOperations.userId, token.userId))
        .limit(1);
      if (deleting) throw new Error('ACCOUNT_CREDENTIAL_WRITE_BLOCKED');
      await tx
        .insert(schema.candidateOAuthTokens)
        .values(token)
        .onConflictDoUpdate({
          target: schema.candidateOAuthTokens.requestId,
          set: {
            accessTokenEnc: token.accessTokenEnc,
            refreshTokenEnc: token.refreshTokenEnc,
            iv: token.iv,
            refreshIv: token.refreshIv,
            accessTokenExpiresAt: token.accessTokenExpiresAt,
            scope: token.scope,
            grantedAt: token.grantedAt,
            lastRefreshedAt: token.lastRefreshedAt,
            revokedAt: token.revokedAt,
          },
        });
    });
  }

  async findByRequestId(requestId: string): Promise<CandidateOAuthToken | null> {
    const [row] = await this.db
      .select()
      .from(schema.candidateOAuthTokens)
      .where(eq(schema.candidateOAuthTokens.requestId, requestId))
      .limit(1);
    return row ?? null;
  }

  async markRefreshed(
    requestId: string,
    accessTokenEnc: Buffer,
    iv: Buffer,
    expiresAt: Date,
  ): Promise<void> {
    await this.db
      .update(schema.candidateOAuthTokens)
      .set({
        accessTokenEnc,
        iv,
        accessTokenExpiresAt: expiresAt,
        lastRefreshedAt: new Date(),
      })
      .where(eq(schema.candidateOAuthTokens.requestId, requestId));
  }

  async markRevoked(requestId: string): Promise<void> {
    await this.db
      .update(schema.candidateOAuthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.candidateOAuthTokens.requestId, requestId));
  }

  async delete(requestId: string): Promise<void> {
    await this.db
      .delete(schema.candidateOAuthTokens)
      .where(eq(schema.candidateOAuthTokens.requestId, requestId));
  }
}
