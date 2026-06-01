// LAYER: Tests / Integration Helpers
// Seed helpers for integration tests. Operates on the real test database.

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  users,
  messagingIdentities,
  conversationStates,
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
