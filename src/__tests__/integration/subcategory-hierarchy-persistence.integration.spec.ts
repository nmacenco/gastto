// LAYER: Infrastructure / Integration Tests
// Verifies the linked-subcategory migration and deletion semantics against PostgreSQL.

import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import * as schema from '../../infrastructure/db/schema';
import { CategoryVocabulary } from '../../domain/entities/CategoryVocabulary';
import { DrizzleCategoryVocabularyRepository } from '../../infrastructure/db/repositories/DrizzleCategoryVocabularyRepository';

const userId = '11111111-1111-4111-8111-111111111111';
const spreadsheetId = '22222222-2222-4222-8222-222222222222';
const foodCategoryId = '33333333-3333-4333-8333-333333333333';
const leisureCategoryId = '44444444-4444-4444-8444-444444444444';
const restaurantSubcategoryId = '55555555-5555-4555-8555-555555555555';

let container: StartedPostgreSqlContainer;
let client: postgres.Sql;
let db: PostgresJsDatabase<typeof schema>;

const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const migrationsFolder = path.resolve(__dirname, '../../infrastructure/db/migrations');

async function applyMigrations(
  sqlClient: postgres.Sql,
  migrations: MigrationMeta[],
): Promise<void> {
  for (const migration of migrations) {
    await sqlClient.begin(async (transaction) => {
      for (const statement of migration.sql) {
        if (statement.trim().length > 0) await transaction.unsafe(statement);
      }
    });
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  client = postgres(container.getConnectionUri(), { max: 1 });
  await client`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder,
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

  it('preserves snapshots when vocabulary rows are renamed or deactivated', async () => {
    const expenseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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

    await db
      .update(schema.userCategories)
      .set({ rawValue: 'Meals', normalizedValue: 'meals', isActive: false })
      .where(eq(schema.userCategories.id, foodCategoryId));
    await db
      .update(schema.userSubcategories)
      .set({ rawValue: 'Dining out', normalizedValue: 'dining out', isActive: false })
      .where(eq(schema.userSubcategories.id, restaurantSubcategoryId));

    const [expense] = await db
      .select()
      .from(schema.expenseRecords)
      .where(eq(schema.expenseRecords.id, expenseId));
    expect(expense).toMatchObject({
      categoria: 'Food',
      categoryId: foodCategoryId,
      subcategoria: 'Restaurant',
      subcategoryId: restaurantSubcategoryId,
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

  it('round-trips stable hierarchy ids and saves the same aggregate idempotently', async () => {
    const repository = new DrizzleCategoryVocabularyRepository(db);
    const vocabulary = new CategoryVocabulary('22222222-2222-4222-8222-222222222222', [
      { id: foodCategoryId, name: 'Food', normalizedName: 'food' },
      { id: leisureCategoryId, name: 'Leisure', normalizedName: 'leisure' },
    ]);
    const child = vocabulary.addSubcategory(foodCategoryId, 'Restaurant');

    await repository.save(vocabulary);
    await repository.save(vocabulary);

    const reloaded = await repository.findBySpreadsheetId(spreadsheetId);
    expect(reloaded?.getCategories().map(({ id }) => id)).toEqual([
      foodCategoryId,
      leisureCategoryId,
    ]);
    expect(reloaded?.getSubcategories()).toEqual([
      {
        id: child.id,
        categoryId: foodCategoryId,
        name: 'Restaurant',
        normalizedName: 'restaurant',
      },
    ]);
    await expect(db.select().from(schema.userCategories)).resolves.toHaveLength(2);
    await expect(db.select().from(schema.userSubcategories)).resolves.toHaveLength(1);
  });

  it('moves a child by updating only its parent reference', async () => {
    await db.insert(schema.userSubcategories).values({
      id: restaurantSubcategoryId,
      categoryId: foodCategoryId,
      rawValue: 'Restaurant',
      normalizedValue: 'restaurant',
    });
    const repository = new DrizzleCategoryVocabularyRepository(db);
    const vocabulary = await repository.findBySpreadsheetId(spreadsheetId);
    expect(vocabulary).not.toBeNull();

    vocabulary!.moveSubcategory(restaurantSubcategoryId, leisureCategoryId);
    await repository.save(vocabulary!);

    const [row] = await db
      .select()
      .from(schema.userSubcategories)
      .where(eq(schema.userSubcategories.id, restaurantSubcategoryId));
    expect(row).toMatchObject({
      id: restaurantSubcategoryId,
      categoryId: leisureCategoryId,
      rawValue: 'Restaurant',
      normalizedValue: 'restaurant',
      isActive: true,
    });
  });

  it('soft-disables a removed child and a removed category branch', async () => {
    await db.insert(schema.userSubcategories).values([
      {
        id: restaurantSubcategoryId,
        categoryId: foodCategoryId,
        rawValue: 'Restaurant',
        normalizedValue: 'restaurant',
      },
      {
        id: '99999999-9999-4999-8999-999999999999',
        categoryId: leisureCategoryId,
        rawValue: 'Cinema',
        normalizedValue: 'cinema',
      },
    ]);
    const repository = new DrizzleCategoryVocabularyRepository(db);
    const vocabulary = await repository.findBySpreadsheetId(spreadsheetId);
    expect(vocabulary).not.toBeNull();

    vocabulary!.removeSubcategory(restaurantSubcategoryId);
    vocabulary!.removeCategory(leisureCategoryId);
    await repository.save(vocabulary!);

    const categories = await db.select().from(schema.userCategories);
    const subcategories = await db.select().from(schema.userSubcategories);
    expect(categories.find(({ id }) => id === foodCategoryId)?.isActive).toBe(true);
    expect(categories.find(({ id }) => id === leisureCategoryId)?.isActive).toBe(false);
    expect(subcategories.every(({ isActive }) => !isActive)).toBe(true);
  });

  it('rolls back parent changes when a child mutation fails', async () => {
    const repository = new DrizzleCategoryVocabularyRepository(db);
    const invalidVocabulary = new CategoryVocabulary(
      spreadsheetId,
      [
        { id: foodCategoryId, name: 'Groceries', normalizedName: 'groceries' },
        { id: leisureCategoryId, name: 'Leisure', normalizedName: 'leisure' },
      ],
      [
        {
          id: 'not-a-uuid',
          categoryId: foodCategoryId,
          name: 'Restaurant',
          normalizedName: 'restaurant',
        },
      ],
    );

    await expect(repository.save(invalidVocabulary)).rejects.toThrow();

    const categories = await db.select().from(schema.userCategories);
    expect(categories.find(({ id }) => id === foodCategoryId)).toMatchObject({
      rawValue: 'Food',
      normalizedValue: 'food',
      isActive: true,
    });
    await expect(db.select().from(schema.userSubcategories)).resolves.toEqual([]);
  });
});

describePostgres('linked-subcategory generated migration chain (PostgreSQL)', () => {
  it('upgrades pre-hierarchy history without backfill and installs the release constraints', async () => {
    const databaseName = 'gastto_legacy_upgrade';
    await client`CREATE DATABASE ${client(databaseName)}`;
    const upgradeClient = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: databaseName,
      username: container.getUsername(),
      password: container.getPassword(),
      max: 1,
    });

    try {
      await upgradeClient`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
      const migrations = readMigrationFiles({ migrationsFolder });
      expect(migrations).toHaveLength(9);

      await applyMigrations(upgradeClient, migrations.slice(0, 7));
      await upgradeClient`INSERT INTO users (user_id, status) VALUES (${userId}, 'active')`;
      await upgradeClient`
        INSERT INTO spreadsheet_configs
          (id, user_id, provider, file_id, file_name, sheet_name, access_verified_at)
        VALUES
          (${spreadsheetId}, ${userId}, 'google', 'legacy-file', 'Legacy expenses', 'Gastos', now())
      `;
      const legacyExpenseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      await upgradeClient`
        INSERT INTO expense_records
          (id, user_id, spreadsheet_id, concepto, monto, moneda, categoria, fecha_gasto,
           medio_pago, sheet_name, row_index, categoria_confidence, raw_message)
        VALUES
          (${legacyExpenseId}, ${userId}, ${spreadsheetId}, 'Legacy dinner', 12.50, 'EUR',
           'Food', '2026-09-01', 'Card', 'Gastos', 2, 'alta', 'Legacy dinner 12.50 EUR')
      `;

      await applyMigrations(upgradeClient, migrations.slice(7));

      const [legacyRow] = await upgradeClient`
        SELECT category_id, subcategory_id, subcategoria
        FROM expense_records
        WHERE id = ${legacyExpenseId}
      `;
      expect(legacyRow).toMatchObject({
        category_id: null,
        subcategory_id: null,
        subcategoria: null,
      });

      const tables = await upgradeClient<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('user_subcategories', 'expense_records', 'column_mappings')
      `;
      expect(tables.map(({ table_name }) => table_name).sort()).toEqual([
        'column_mappings',
        'expense_records',
        'user_subcategories',
      ]);

      const indexes = await upgradeClient<{ indexname: string }[]>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'idx_user_subcategories_category',
            'uq_category_subcategory',
            'idx_expense_records_category',
            'idx_expense_records_subcategory'
          )
      `;
      expect(indexes.map(({ indexname }) => indexname).sort()).toEqual([
        'idx_expense_records_category',
        'idx_expense_records_subcategory',
        'idx_user_subcategories_category',
        'uq_category_subcategory',
      ]);

      const foreignKeys = await upgradeClient`
        SELECT conname, confdeltype
        FROM pg_constraint
        WHERE conname IN (
          'user_subcategories_category_id_user_categories_id_fk',
          'expense_records_category_id_user_categories_id_fk',
          'expense_records_subcategory_id_user_subcategories_id_fk'
        )
        ORDER BY conname
      `;
      expect(foreignKeys).toEqual([
        expect.objectContaining({
          conname: 'expense_records_category_id_user_categories_id_fk',
          confdeltype: 'n',
        }),
        expect.objectContaining({
          conname: 'expense_records_subcategory_id_user_subcategories_id_fk',
          confdeltype: 'n',
        }),
        expect.objectContaining({
          conname: 'user_subcategories_category_id_user_categories_id_fk',
          confdeltype: 'c',
        }),
      ]);

      const [mappingConstraint] = await upgradeClient`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conname = 'chk_gastto_field'
      `;
      expect(mappingConstraint?.definition).toContain("'subcategoria'::text");
      await expect(
        upgradeClient`
          INSERT INTO column_mappings
            (spreadsheet_id, gastto_field, column_index, column_header)
          VALUES (${spreadsheetId}, 'subcategoria', 3, 'Subcategoría')
        `,
      ).resolves.toBeDefined();
      await expect(
        upgradeClient`
          INSERT INTO column_mappings
            (spreadsheet_id, gastto_field, column_index, column_header)
          VALUES (${spreadsheetId}, 'merchant', 4, 'Merchant')
        `,
      ).rejects.toThrow();
    } finally {
      await upgradeClient.end();
    }
  });
});
