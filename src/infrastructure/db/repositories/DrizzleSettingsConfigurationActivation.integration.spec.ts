import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { DrizzleSettingsConfigurationActivation } from './DrizzleSettingsConfigurationActivation';

const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const userId = '11111111-1111-4111-8111-111111111111';
const sourceConfigId = '22222222-2222-4222-8222-222222222222';
let container: StartedPostgreSqlContainer;
let client: postgres.Sql;
let db: PostgresJsDatabase<typeof schema>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  client = postgres(container.getConnectionUri(), { max: 5 });
  await client`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../migrations') });
});

beforeEach(async () => {
  await db.delete(schema.conversationStates);
  await db.delete(schema.spreadsheetConfigs);
  await db.delete(schema.users);
  await db.insert(schema.users).values({ userId, status: 'active' });
  await db.insert(schema.spreadsheetConfigs).values({
    id: sourceConfigId,
    userId,
    provider: 'google',
    fileId: 'old-file',
    fileName: 'Old',
    sheetName: 'Old',
    accessVerifiedAt: new Date(),
    categoriesConfirmedAt: new Date(),
    headerRowIndex: 1,
  });
  await db.insert(schema.conversationStates).values({
    userId,
    currentState: 'SETTINGS_CATEGORIES',
    revision: 3n,
    expiresAt: new Date(Date.now() + 60_000),
    statePayload: {
      flowId: 'flow-1',
      proposalId: 'proposal-1',
      sourceConfigId,
      fileId: 'new-file',
      sheetName: 'New',
    },
  });
});

afterAll(async () => {
  if (client) await client.end();
  if (container) await container.stop();
});

function input() {
  return {
    userId,
    expected: { revision: '3', currentState: 'SETTINGS_CATEGORIES', expiry: 'unexpired' as const },
    candidate: {
      flowId: 'flow-1',
      proposalId: 'proposal-1',
      sourceConfigId,
      provider: 'google' as const,
      fileId: 'new-file',
      fileName: 'New',
      sheetName: 'New',
      headerRowIndex: 1,
      accessVerifiedAt: new Date(),
      mappings: [
        { field: 'monto' as const, columnIndex: 0, columnHeader: 'Amount' },
        { field: 'categoria' as const, columnIndex: 1, columnHeader: 'Category' },
      ],
      categories: [{ name: 'Food', subcategories: ['Restaurant'] }],
    },
  };
}

describePostgres('Settings configuration activation (PostgreSQL)', () => {
  it('defaults existing-style inserts to active and rejects a second active row', async () => {
    const source = (
      await db
        .select()
        .from(schema.spreadsheetConfigs)
        .where(eq(schema.spreadsheetConfigs.id, sourceConfigId))
    )[0];
    expect(source?.isActive).toBe(true);
    await expect(
      db.insert(schema.spreadsheetConfigs).values({
        userId,
        provider: 'google',
        fileId: 'other',
        fileName: 'Other',
        sheetName: 'Other',
        accessVerifiedAt: new Date(),
      }),
    ).rejects.toThrow();
    await db.insert(schema.spreadsheetConfigs).values({
      userId,
      provider: 'google',
      fileId: 'candidate',
      fileName: 'Candidate',
      sheetName: 'Candidate',
      accessVerifiedAt: new Date(),
      isActive: false,
    });
    expect(
      (
        await db
          .select()
          .from(schema.spreadsheetConfigs)
          .where(eq(schema.spreadsheetConfigs.userId, userId))
      ).filter((row) => row.isActive),
    ).toHaveLength(1);
  });

  it('preserves the previous version and permits only one active row', async () => {
    const activation = new DrizzleSettingsConfigurationActivation(db);
    expect(await activation.execute(input())).toBe('activated');
    const rows = await db
      .select()
      .from(schema.spreadsheetConfigs)
      .where(eq(schema.spreadsheetConfigs.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === sourceConfigId)).toMatchObject({
      fileId: 'old-file',
      isActive: false,
    });
    const active = rows.find((row) => row.isActive);
    expect(active).toMatchObject({ fileId: 'new-file', headerRowIndex: 1 });
    expect(
      await db
        .select()
        .from(schema.columnMappings)
        .where(eq(schema.columnMappings.spreadsheetId, active!.id)),
    ).toHaveLength(2);
    const categories = await db
      .select()
      .from(schema.userCategories)
      .where(eq(schema.userCategories.spreadsheetId, active!.id));
    expect(categories).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.userSubcategories)
        .where(eq(schema.userSubcategories.categoryId, categories[0]!.id)),
    ).toHaveLength(1);
    expect(
      (
        await db
          .select()
          .from(schema.conversationStates)
          .where(eq(schema.conversationStates.userId, userId))
      )[0]?.currentState,
    ).toBe('IDLE');
  });

  it('rolls back the full transaction on a mapping conflict', async () => {
    const duplicate = input();
    duplicate.candidate.mappings[1]!.columnIndex = 0;
    await expect(
      new DrizzleSettingsConfigurationActivation(db).execute(duplicate),
    ).rejects.toThrow();
    const rows = await db
      .select()
      .from(schema.spreadsheetConfigs)
      .where(eq(schema.spreadsheetConfigs.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: sourceConfigId, isActive: true });
    expect(
      (
        await db
          .select()
          .from(schema.conversationStates)
          .where(eq(schema.conversationStates.userId, userId))
      )[0]?.currentState,
    ).toBe('SETTINGS_CATEGORIES');
  });

  it('rejects stale and concurrent activation without creating extra versions', async () => {
    const activation = new DrizzleSettingsConfigurationActivation(db);
    const stale = input();
    stale.expected.revision = '2';
    expect(await activation.execute(stale)).toBe('stale');
    const outcomes = await Promise.all([activation.execute(input()), activation.execute(input())]);
    expect(outcomes.sort()).toEqual(['activated', 'stale']);
    expect(
      await db
        .select()
        .from(schema.spreadsheetConfigs)
        .where(eq(schema.spreadsheetConfigs.userId, userId)),
    ).toHaveLength(2);
  });
});
