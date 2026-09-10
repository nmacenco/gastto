// LAYER: Infrastructure / Integration Tests
// Verifies the generated column-mapping CHECK constraint against PostgreSQL.

import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../infrastructure/db/schema';

const userId = '11111111-1111-4111-8111-111111111111';
const spreadsheetId = '22222222-2222-4222-8222-222222222222';

const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;

describePostgres('column mapping constraint (PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer;
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof schema>;

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
    await db.delete(schema.columnMappings);
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
      accessVerifiedAt: new Date('2026-09-04T10:00:00Z'),
    });
  });

  afterAll(async () => {
    if (client) await client.end();
    if (container) await container.stop();
  });

  it('accepts an optional subcategory mapping', async () => {
    await db.insert(schema.columnMappings).values({
      spreadsheetId,
      gasttoField: 'subcategoria',
      columnIndex: 3,
      columnHeader: 'Subcategoría',
    });

    const rows = await db
      .select()
      .from(schema.columnMappings)
      .where(eq(schema.columnMappings.spreadsheetId, spreadsheetId));

    expect(rows).toEqual([
      expect.objectContaining({ gasttoField: 'subcategoria', columnHeader: 'Subcategoría' }),
    ]);
  });

  it('still rejects unsupported field names', async () => {
    await expect(
      db.insert(schema.columnMappings).values({
        spreadsheetId,
        gasttoField: 'merchant',
        columnIndex: 3,
        columnHeader: 'Merchant',
      }),
    ).rejects.toThrow();
  });

  it('preserves existing category-only mappings', async () => {
    await db.insert(schema.columnMappings).values([
      {
        spreadsheetId,
        gasttoField: 'fecha',
        columnIndex: 0,
        columnHeader: 'Fecha',
      },
      {
        spreadsheetId,
        gasttoField: 'categoria',
        columnIndex: 1,
        columnHeader: 'Categoría',
      },
    ]);

    const rows = await db
      .select({ gasttoField: schema.columnMappings.gasttoField })
      .from(schema.columnMappings)
      .where(eq(schema.columnMappings.spreadsheetId, spreadsheetId));

    expect(rows.map((row) => row.gasttoField)).toEqual(
      expect.arrayContaining(['fecha', 'categoria']),
    );
    expect(rows).toHaveLength(2);
  });
});
