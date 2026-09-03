// LAYER: Infrastructure / Integration Tests
// Verifies the linked-subcategory migration and deletion semantics against PostgreSQL.

import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../infrastructure/db/schema';

const userId = '11111111-1111-4111-8111-111111111111';
const spreadsheetId = '22222222-2222-4222-8222-222222222222';
const foodCategoryId = '33333333-3333-4333-8333-333333333333';
const leisureCategoryId = '44444444-4444-4444-8444-444444444444';
const restaurantSubcategoryId = '55555555-5555-4555-8555-555555555555';

let container: StartedPostgreSqlContainer;
let client: postgres.Sql;
let db: PostgresJsDatabase<typeof schema>;

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
  await db.delete(schema.expenseRecords);
  await db.delete(schema.userSubcategories);
  await db.delete(schema.userCategories);
  await db.delete(schema.spreadsheetConfigs);
  await db.delete(schema.users);

  await db.insert(schema.users).values({ userId, status: 'active' });
  await db.insert(schema.spreadsheetConfigs).values({
    id: spreadsheetId,
    userId,
    provider: 'google',
    fileId: 'file-1',
    fileName: 'Expenses',
    sheetName: 'Gastos',
    accessVerifiedAt: new Date('2026-09-03T10:00:00Z'),
  });
  await db.insert(schema.userCategories).values([
    {
      id: foodCategoryId,
      spreadsheetId,
      rawValue: 'Food',
      normalizedValue: 'food',
    },
    {
      id: leisureCategoryId,
      spreadsheetId,
      rawValue: 'Leisure',
      normalizedValue: 'leisure',
    },
  ]);
});

afterAll(async () => {
  if (client) await client.end();
  if (container) await container.stop();
});

function legacyExpense(id: string) {
  return {
    id,
    userId,
    spreadsheetId,
    concepto: 'Dinner',
    monto: '24.50',
    moneda: 'EUR',
    categoria: 'Food',
    fechaGasto: '2026-09-03',
    medioPago: 'Card',
    sheetName: 'Gastos',
    rowIndex: 2,
    categoriaConfidence: 'alta',
    rawMessage: 'Dinner 24.50 EUR',
  };
}

describePostgres('subcategory hierarchy persistence (PostgreSQL)', () => {
  it('keeps legacy expenses valid with null hierarchy fields', async () => {
    const expenseId = '66666666-6666-4666-8666-666666666666';

    await db.insert(schema.expenseRecords).values(legacyExpense(expenseId));

    const [expense] = await db
      .select()
      .from(schema.expenseRecords)
      .where(eq(schema.expenseRecords.id, expenseId));

    expect(expense).toMatchObject({
      categoryId: null,
      subcategoryId: null,
      subcategoria: null,
    });
  });

  it('scopes normalized subcategory uniqueness to the parent category', async () => {
    await db.insert(schema.userSubcategories).values({
      id: restaurantSubcategoryId,
      categoryId: foodCategoryId,
      rawValue: 'Restaurant',
      normalizedValue: 'restaurant',
    });

    await expect(
      db.insert(schema.userSubcategories).values({
        categoryId: foodCategoryId,
        rawValue: 'RESTAURANT',
        normalizedValue: 'restaurant',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(schema.userSubcategories).values({
        categoryId: leisureCategoryId,
        rawValue: 'Restaurant',
        normalizedValue: 'restaurant',
      }),
    ).resolves.toBeDefined();

    await expect(db.select().from(schema.userSubcategories)).resolves.toHaveLength(2);
  });

  it('rejects a subcategory whose parent category does not exist', async () => {
    await expect(
      db.insert(schema.userSubcategories).values({
        categoryId: '77777777-7777-4777-8777-777777777777',
        rawValue: 'Orphan',
        normalizedValue: 'orphan',
      }),
    ).rejects.toThrow();
  });

  it('cascades configured children and clears references without changing snapshots', async () => {
    const expenseId = '88888888-8888-4888-8888-888888888888';
    await db.insert(schema.userSubcategories).values({
      id: restaurantSubcategoryId,
      categoryId: foodCategoryId,
      rawValue: 'Restaurant',
      normalizedValue: 'restaurant',
    });
    await db.insert(schema.expenseRecords).values({
      ...legacyExpense(expenseId),
      categoryId: foodCategoryId,
      subcategoryId: restaurantSubcategoryId,
      subcategoria: 'Restaurant',
    });

    await db.delete(schema.userCategories).where(eq(schema.userCategories.id, foodCategoryId));

    await expect(
      db
        .select()
        .from(schema.userSubcategories)
        .where(eq(schema.userSubcategories.id, restaurantSubcategoryId)),
    ).resolves.toHaveLength(0);

    const [expense] = await db
      .select()
      .from(schema.expenseRecords)
      .where(eq(schema.expenseRecords.id, expenseId));
    expect(expense).toMatchObject({
      categoria: 'Food',
      subcategoria: 'Restaurant',
      categoryId: null,
      subcategoryId: null,
    });
  });
});
