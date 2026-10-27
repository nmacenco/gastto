import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { DrizzleOnboardingVocabularyCommit } from './DrizzleOnboardingVocabularyCommit';

const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const userId = '11111111-1111-4111-8111-111111111111';
const configId = '22222222-2222-4222-8222-222222222222';
const categoryId = '33333333-3333-4333-8333-333333333333';
const childId = '44444444-4444-4444-8444-444444444444';
const categoryDraft = {
  categories: [{ id: categoryId, name: 'Meals', normalizedName: 'meals' }],
  subcategories: [{ id: childId, categoryId, name: 'Restaurant', normalizedName: 'restaurant' }],
};
const categories = [{ name: 'Meals', subcategories: ['Restaurant'] }];
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
  await db.delete(schema.userPaymentMethods);
  await db.delete(schema.conversationStates);
  await db.delete(schema.userSubcategories);
  await db.delete(schema.userCategories);
  await db.delete(schema.spreadsheetConfigs);
  await db.delete(schema.users);
  await db.insert(schema.users).values({ userId, status: 'onboarding' });
  await db.insert(schema.spreadsheetConfigs).values({
    id: configId,
    userId,
    provider: 'google',
    fileId: 'file',
    fileName: 'File',
    sheetName: 'Sheet',
    accessVerifiedAt: new Date(),
    headerRowIndex: 1,
  });
  await db.insert(schema.conversationStates).values({
    userId,
    currentState: 'ONBOARDING_CATEGORIES',
    revision: 3n,
    statePayload: {
      categories,
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
      paymentReview: true,
      paymentMethods: ['Visa'],
      categoryDraft,
    },
  });
});
afterAll(async () => {
  if (client) await client.end();
  if (container) await container.stop();
});

describePostgres('onboarding vocabulary finalization (PostgreSQL)', () => {
  const input = () => ({
    userId,
    sourceConfigId: configId,
    expected: { revision: '3', currentState: 'ONBOARDING_CATEGORIES', expiry: 'any' as const },
    categories,
    paymentMethods: ['Visa'],
    categoryDraft,
  });

  it('commits both catalogs, markers, user activation, and IDLE together', async () => {
    await expect(new DrizzleOnboardingVocabularyCommit(db).execute(input())).resolves.toBe(
      'committed',
    );
    expect(await db.select().from(schema.userCategories)).toMatchObject([
      { id: categoryId, rawValue: 'Meals', isActive: true },
    ]);
    expect(await db.select().from(schema.userSubcategories)).toMatchObject([
      { id: childId, categoryId, rawValue: 'Restaurant', isActive: true },
    ]);
    expect(await db.select().from(schema.userPaymentMethods)).toMatchObject([
      { spreadsheetId: configId, displayName: 'Visa', isActive: true },
    ]);
    const [config] = await db
      .select()
      .from(schema.spreadsheetConfigs)
      .where(eq(schema.spreadsheetConfigs.id, configId));
    expect(config?.categoriesConfirmedAt).toBeInstanceOf(Date);
    expect(config?.paymentMethodsConfirmedAt).toBeInstanceOf(Date);
    const [state] = await db
      .select()
      .from(schema.conversationStates)
      .where(eq(schema.conversationStates.userId, userId));
    expect(state).toMatchObject({ currentState: 'IDLE', statePayload: null, revision: 4n });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.userId, userId));
    expect(user?.status).toBe('active');
  });

  it('rolls back a malformed payment proposal and rejects stale replays', async () => {
    const adapter = new DrizzleOnboardingVocabularyCommit(db);
    await db
      .update(schema.conversationStates)
      .set({
        statePayload: {
          categories,
          orphanSubcategories: [],
          subcategoryColumnMapped: true,
          paymentReview: true,
          paymentMethods: ['Visa', 'visa'],
          categoryDraft,
        },
      })
      .where(eq(schema.conversationStates.userId, userId));
    await expect(adapter.execute({ ...input(), paymentMethods: ['Visa', 'visa'] })).resolves.toBe(
      'conflict',
    );
    expect(await db.select().from(schema.userCategories)).toHaveLength(0);
    expect(await db.select().from(schema.userPaymentMethods)).toHaveLength(0);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.userId, userId));
    expect(user?.status).toBe('onboarding');
    await expect(adapter.execute(input())).resolves.toBe('stale');
  });
});
