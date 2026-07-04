// LAYER: Tests / Integration
// End-to-end connectivity test for the PostgreSQL testcontainer stack.
// Seeds a user and a conversation state, then reads it back via the real repository.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as schema from '../../../src/infrastructure/db/schema';
import {
  startDbContainer,
  stopDbContainer,
  getConnectionString,
  isDockerAvailable,
} from '../helpers/db-container';
import { runMigrations } from '../helpers/migrate';
import { createUser, createConversationState } from '../helpers/fixtures';
import { DrizzleConversationStateRepository } from '../../../src/infrastructure/db/repositories/DrizzleConversationStateRepository';

describe.skipIf(!isDockerAvailable())('Integration :: DB Connectivity', () => {
  let container: StartedPostgreSqlContainer;
  let pgClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    container = await startDbContainer();
    pgClient = postgres(getConnectionString(container), { max: 1 });
    await runMigrations(pgClient);
    db = drizzle(pgClient, { schema });
  }, 60000);

  afterAll(async () => {
    if (pgClient) await pgClient.end();
    if (container) await stopDbContainer(container);
  });

  it('seeds a user, persists a conversation state, and reads it back via the repository', async () => {
    const user = await createUser(db);
    await createConversationState(db, {
      userId: user.userId,
      currentState: 'EXPENSE_REVIEW',
      statePayload: { amount: 850, concept: 'Cafe con leche' },
    });

    const repo = new DrizzleConversationStateRepository(db);
    const state = await repo.findByUserId(user.userId);

    expect(state).not.toBeNull();
    expect(state!.currentState).toBe('EXPENSE_REVIEW');
    expect(state!.statePayload).toEqual({ amount: 850, concept: 'Cafe con leche' });
    expect(state!.userId).toBe(user.userId);
    expect(state!.expiresAt).toBeNull();
  });
});
