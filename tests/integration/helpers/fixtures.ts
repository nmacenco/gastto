// LAYER: Tests / Integration Helpers
// Seed helpers for integration tests. Operates on the real test database.

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  users,
  messagingIdentities,
  conversationStates,
  oauthTokens,
  spreadsheetConfigs,
} from '../../../src/infrastructure/db/schema';
import type * as schema from '../../../src/infrastructure/db/schema';

export async function createUser(
  db: PostgresJsDatabase<typeof schema>,
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<typeof users.$inferSelect> {
  const [row] = await db
    .insert(users)
    .values({
      status: 'active',
      defaultCurrency: null,
      ...overrides,
    })
    .returning();

  if (!row) throw new Error('Failed to create user');
  return row;
}

export async function createMessagingIdentity(
  db: PostgresJsDatabase<typeof schema>,
  overrides: Partial<typeof messagingIdentities.$inferInsert> & { userId: string },
): Promise<typeof messagingIdentities.$inferSelect> {
  const [row] = await db
    .insert(messagingIdentities)
    .values({
      channel: 'telegram',
      externalId: '123456789',
      ...overrides,
    })
    .returning();

  if (!row) throw new Error('Failed to create messaging identity');
  return row;
}

export async function createConversationState(
  db: PostgresJsDatabase<typeof schema>,
  overrides: Partial<typeof conversationStates.$inferInsert> & { userId: string },
): Promise<typeof conversationStates.$inferSelect> {
  const [row] = await db
    .insert(conversationStates)
    .values({
      currentState: 'IDLE',
      statePayload: null,
      expiresAt: null,
      ...overrides,
    })
    .returning();

  if (!row) throw new Error('Failed to create conversation state');
  return row;
}

export async function createOAuthToken(
  db: PostgresJsDatabase<typeof schema>,
  overrides: Partial<typeof oauthTokens.$inferInsert> & { userId: string },
): Promise<typeof oauthTokens.$inferSelect> {
  const [row] = await db
    .insert(oauthTokens)
    .values({
      provider: 'google',
      accessTokenEnc: Buffer.from('encrypted-access-token'),
      refreshTokenEnc: Buffer.from('encrypted-refresh-token'),
      iv: Buffer.from('initialization-vector'),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      scope: ['https://www.googleapis.com/auth/drive.file'],
      grantedAt: new Date(),
      lastRefreshedAt: null,
      revokedAt: null,
      ...overrides,
    })
    .returning();

  if (!row) throw new Error('Failed to create OAuth token');
  return row;
}

export async function createSpreadsheetConfig(
  db: PostgresJsDatabase<typeof schema>,
  overrides: Partial<typeof spreadsheetConfigs.$inferInsert> & { userId: string },
): Promise<typeof spreadsheetConfigs.$inferSelect> {
  const [row] = await db
    .insert(spreadsheetConfigs)
    .values({
      provider: 'google',
      fileId: 'file-123',
      fileName: 'Test Spreadsheet',
      sheetName: 'Gastos',
      accessVerifiedAt: new Date(),
      ...overrides,
    })
    .returning();

  if (!row) throw new Error('Failed to create spreadsheet config');
  return row;
}
