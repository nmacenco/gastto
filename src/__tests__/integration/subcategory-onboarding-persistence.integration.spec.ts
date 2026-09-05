// LAYER: Infrastructure / Integration Tests
// End-to-end persistence checks for hierarchy confirmation against PostgreSQL.

import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Redis } from 'ioredis';
import postgres from 'postgres';
import { ConfirmCategories } from '../../application/use-cases/spreadsheet/ConfirmCategories';
import { TransitionConversationState } from '../../application/use-cases/conversation/TransitionConversationState';
import { DrizzleCategoryVocabularyRepository } from '../../infrastructure/db/repositories/DrizzleCategoryVocabularyRepository';
import { DrizzleConversationStateRepository } from '../../infrastructure/db/repositories/DrizzleConversationStateRepository';
import { DrizzleSpreadsheetConfigRepository } from '../../infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository';
import { DrizzleUserRepository } from '../../infrastructure/db/repositories/DrizzleUserRepository';
import * as schema from '../../infrastructure/db/schema';

const userId = '11111111-1111-4111-8111-111111111111';
const spreadsheetId = '22222222-2222-4222-8222-222222222222';
const foodId = '33333333-3333-4333-8333-333333333333';
const leisureId = '44444444-4444-4444-8444-444444444444';
const restaurantId = '55555555-5555-4555-8555-555555555555';
const cinemaId = '66666666-6666-4666-8666-666666666666';

let container: StartedPostgreSqlContainer;
let client: postgres.Sql;
let db: PostgresJsDatabase<typeof schema>;
const sendMessage = vi.fn().mockResolvedValue({ status: 'success' });

const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  client = postgres(container.getConnectionUri(), { max: 1 });
  await client`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../../infrastructure/db/migrations'),
  });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await client.unsafe('DROP TRIGGER IF EXISTS reject_subcategory_insert ON user_subcategories');
  await client.unsafe('DROP FUNCTION IF EXISTS reject_subcategory_insert()');
  await db.delete(schema.userSubcategories);
  await db.delete(schema.userCategories);
  await db.delete(schema.conversationStates);
  await db.delete(schema.spreadsheetConfigs);
  await db.delete(schema.users);
  await db.insert(schema.users).values({ userId, status: 'onboarding' });
  await db.insert(schema.spreadsheetConfigs).values({
    id: spreadsheetId,
    userId,
    provider: 'google',
    fileId: 'file-1',
    fileName: 'Expenses',
    sheetName: 'Gastos',
    accessVerifiedAt: new Date('2026-09-05T10:00:00Z'),
  });
  await db.insert(schema.conversationStates).values({
    userId,
    currentState: 'ONBOARDING_CATEGORIES',
    statePayload: null,
    expiresAt: new Date('2026-09-05T11:00:00Z'),
  });
});

afterAll(async () => {
  if (client) await client.end();
  if (container) await container.stop();
});

function buildUseCase() {
  const conversationRepository = new DrizzleConversationStateRepository(db);
  return new ConfirmCategories({
    spreadsheetConfigRepository: new DrizzleSpreadsheetConfigRepository(db),
    categoryVocabularyRepository: new DrizzleCategoryVocabularyRepository(db),
    userRepository: new DrizzleUserRepository(db, {} as Redis),
    messagingPort: { sendMessage },
    transitionState: new TransitionConversationState(conversationRepository),
  });
}

async function confirm(statePayload: Record<string, unknown>) {
  return buildUseCase().execute({
    userId,
    externalId: 'telegram-user',
    channel: 'telegram',
    statePayload,
  });
}

const canonicalPayload = {
  categories: [
    { name: 'Food', subcategories: ['Restaurant'] },
    { name: 'Leisure', subcategories: ['Cinema'] },
  ],
  orphanSubcategories: ['Unassigned'],
  subcategoryColumnMapped: true,
};

describePostgres('subcategory onboarding confirmation (PostgreSQL)', () => {
  it('persists the complete hierarchy atomically and excludes orphans', async () => {
    await confirm(canonicalPayload);

    const categories = await db.select().from(schema.userCategories);
    const subcategories = await db.select().from(schema.userSubcategories);
    const [user] = await db.select().from(schema.users);
    const [config] = await db.select().from(schema.spreadsheetConfigs);
    const [conversation] = await db.select().from(schema.conversationStates);

    expect(categories.map(({ rawValue }) => rawValue)).toEqual(['Food', 'Leisure']);
    expect(subcategories.map(({ rawValue }) => rawValue)).toEqual(['Restaurant', 'Cinema']);
    expect(subcategories.map(({ rawValue }) => rawValue)).not.toContain('Unassigned');
    expect(user?.status).toBe('active');
    expect(config?.categoriesConfirmedAt).toBeInstanceOf(Date);
    expect(conversation).toMatchObject({
      currentState: 'IDLE',
      statePayload: null,
      expiresAt: null,
    });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('confirms a legacy flat payload without creating children', async () => {
    await confirm({ categories: ['Food', 'Transport'] });

    const categories = await db.select().from(schema.userCategories);
    expect(categories.map(({ rawValue }) => rawValue)).toEqual(['Food', 'Transport']);
    await expect(db.select().from(schema.userSubcategories)).resolves.toEqual([]);
  });

  it('persists equal child names under different parents', async () => {
    await confirm({
      categories: [
        { name: 'Food', subcategories: ['Restaurant'] },
        { name: 'Leisure', subcategories: ['Restaurant'] },
      ],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    });

    const subcategories = await db.select().from(schema.userSubcategories);
    expect(subcategories).toHaveLength(2);
    expect(new Set(subcategories.map(({ categoryId }) => categoryId)).size).toBe(2);
  });

  it('re-confirms idempotently without duplicate relationships', async () => {
    await confirm(canonicalPayload);
    await db
      .update(schema.conversationStates)
      .set({ currentState: 'ONBOARDING_CATEGORIES', statePayload: canonicalPayload })
      .where(eq(schema.conversationStates.userId, userId));
    await confirm(canonicalPayload);

    await expect(db.select().from(schema.userCategories)).resolves.toHaveLength(2);
    await expect(db.select().from(schema.userSubcategories)).resolves.toHaveLength(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('reactivates a confirmed user and clears an interrupted conversation', async () => {
    const confirmedAt = new Date('2026-09-04T10:00:00Z');
    await db
      .update(schema.spreadsheetConfigs)
      .set({ categoriesConfirmedAt: confirmedAt })
      .where(eq(schema.spreadsheetConfigs.id, spreadsheetId));

    await confirm({ categories: ['Food'] });

    const [user] = await db.select().from(schema.users);
    const [config] = await db.select().from(schema.spreadsheetConfigs);
    const [conversation] = await db.select().from(schema.conversationStates);
    expect(user?.status).toBe('active');
    expect(config?.categoriesConfirmedAt).toEqual(confirmedAt);
    expect(conversation).toMatchObject({
      currentState: 'IDLE',
      statePayload: null,
      expiresAt: null,
    });
  });

  it('soft-disables categories and children omitted from the confirmed payload', async () => {
    await db.insert(schema.userCategories).values([
      {
        id: foodId,
        spreadsheetId,
        rawValue: 'Food',
        normalizedValue: 'food',
      },
      {
        id: leisureId,
        spreadsheetId,
        rawValue: 'Leisure',
        normalizedValue: 'leisure',
      },
    ]);
    await db.insert(schema.userSubcategories).values([
      {
        id: restaurantId,
        categoryId: foodId,
        rawValue: 'Restaurant',
        normalizedValue: 'restaurant',
      },
      {
        id: cinemaId,
        categoryId: leisureId,
        rawValue: 'Cinema',
        normalizedValue: 'cinema',
      },
    ]);

    await confirm({
      categories: [{ name: 'Food', subcategories: ['Restaurant'] }],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    });

    const categories = await db.select().from(schema.userCategories);
    const subcategories = await db.select().from(schema.userSubcategories);
    expect(categories.find(({ id }) => id === foodId)?.isActive).toBe(true);
    expect(categories.find(({ id }) => id === leisureId)?.isActive).toBe(false);
    expect(subcategories.find(({ id }) => id === restaurantId)?.isActive).toBe(true);
    expect(subcategories.find(({ id }) => id === cinemaId)?.isActive).toBe(false);
  });

  it('preserves stable ids when reconciling an existing hierarchy', async () => {
    await db.insert(schema.userCategories).values({
      id: foodId,
      spreadsheetId,
      rawValue: 'Food',
      normalizedValue: 'food',
    });
    await db.insert(schema.userSubcategories).values({
      id: restaurantId,
      categoryId: foodId,
      rawValue: 'Restaurant',
      normalizedValue: 'restaurant',
    });

    await confirm({
      categories: [{ name: 'Food', subcategories: ['Restaurant'] }],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    });

    const [category] = await db.select().from(schema.userCategories);
    const [subcategory] = await db.select().from(schema.userSubcategories);
    expect(category?.id).toBe(foodId);
    expect(subcategory?.id).toBe(restaurantId);
  });

  it('rolls back parents and leaves onboarding untouched when a child write fails', async () => {
    await client.unsafe(`
      CREATE FUNCTION reject_subcategory_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'induced child persistence failure';
      END;
      $$
    `);
    await client.unsafe(`
      CREATE TRIGGER reject_subcategory_insert
      BEFORE INSERT ON user_subcategories
      FOR EACH ROW EXECUTE FUNCTION reject_subcategory_insert()
    `);

    await expect(confirm(canonicalPayload)).rejects.toThrow('induced child persistence failure');

    await expect(db.select().from(schema.userCategories)).resolves.toEqual([]);
    await expect(db.select().from(schema.userSubcategories)).resolves.toEqual([]);
    const [user] = await db.select().from(schema.users);
    const [config] = await db.select().from(schema.spreadsheetConfigs);
    const [conversation] = await db.select().from(schema.conversationStates);
    expect(user?.status).toBe('onboarding');
    expect(config?.categoriesConfirmedAt).toBeNull();
    expect(conversation?.currentState).toBe('ONBOARDING_CATEGORIES');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
