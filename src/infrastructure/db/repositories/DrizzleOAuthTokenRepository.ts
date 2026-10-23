// LAYER: Infrastructure
// Drizzle implementation of IOAuthTokenRepository.
// Stores and retrieves encrypted OAuth tokens (ADR-007).

import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { IOAuthTokenRepository } from '../../../domain/ports/repositories';
import type { OAuthToken, SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import * as schema from '../schema';

export class DrizzleOAuthTokenRepository implements IOAuthTokenRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findByUserAndProvider(
    userId: string,
    provider: SpreadsheetProvider,
  ): Promise<OAuthToken | null> {
    const [row] = await this.db
      .select()
      .from(schema.oauthTokens)
      .where(and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, provider)))
      .limit(1);

    return row ? this.mapOAuthToken(row) : null;
  }

  async upsert(token: Omit<OAuthToken, 'id'>): Promise<OAuthToken> {
    const values = {
      userId: token.userId,
      provider: token.provider,
      accessTokenEnc: token.accessTokenEnc,
      refreshTokenEnc: token.refreshTokenEnc,
      iv: token.iv,
      refreshIv: token.refreshIv,
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      scope: token.scope,
      grantedAt: token.grantedAt,
      lastRefreshedAt: token.lastRefreshedAt,
      revokedAt: token.revokedAt,
    };

    const [row] = await this.db
      .insert(schema.oauthTokens)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.oauthTokens.userId, schema.oauthTokens.provider],
        set: {
          accessTokenEnc: token.accessTokenEnc,
          refreshTokenEnc: token.refreshTokenEnc,
          iv: token.iv,
          refreshIv: token.refreshIv,
          accessTokenExpiresAt: token.accessTokenExpiresAt,
          scope: token.scope,
          lastRefreshedAt: token.lastRefreshedAt,
          revokedAt: token.revokedAt,
        },
      })
      .returning();

    if (!row) throw new Error('Failed to upsert OAuth token');

    return this.mapOAuthToken(row);
  }

  async markRefreshed(
    id: string,
    newAccessTokenEnc: Buffer,
    newIv: Buffer,
    newExpiresAt: Date,
  ): Promise<void> {
    const [row] = await this.db
      .update(schema.oauthTokens)
      .set({
        accessTokenEnc: newAccessTokenEnc,
        iv: newIv,
        accessTokenExpiresAt: newExpiresAt,
        lastRefreshedAt: new Date(),
      })
      .where(eq(schema.oauthTokens.id, id))
      .returning();

    if (!row) throw new Error('Failed to mark OAuth token as refreshed');
  }

  async markRevoked(id: string): Promise<void> {
    const [row] = await this.db
      .update(schema.oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.oauthTokens.id, id))
      .returning();

    if (!row) throw new Error('Failed to mark OAuth token as revoked');
  }

  // ── Mappers ────────────────────────────────────────────────────────────────

  private mapOAuthToken(row: typeof schema.oauthTokens.$inferSelect): OAuthToken {
    return {
      id: row.id,
      userId: row.userId,
      provider: row.provider as SpreadsheetProvider,
      accessTokenEnc: row.accessTokenEnc,
      refreshTokenEnc: row.refreshTokenEnc,
      iv: row.iv,
      refreshIv: row.refreshIv,
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      scope: row.scope,
      grantedAt: row.grantedAt,
      lastRefreshedAt: row.lastRefreshedAt ?? null,
      revokedAt: row.revokedAt ?? null,
    };
  }
}
