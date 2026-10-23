// LAYER: Infrastructure / Integration Tests
// Verifies atomic complete mapping replacement against PostgreSQL.

import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../schema';
import { columnMappings, spreadsheetConfigs, users } from '../schema';
import { DrizzleColumnMappingRepository } from './DrizzleColumnMappingRepository';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const spreadsheetId = '33333333-3333-4333-8333-333333333333';
const otherSpreadsheetId = '44444444-4444-4444-8444-444444444444';
const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;

let container: StartedPostgreSqlContainer;
let client: postgres.Sql;
let db: PostgresJsDatabase<typeof schema>;
let repository: DrizzleColumnMappingRepository;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  client = postgres(container.getConnectionUri(), { max: 1 });
  await client`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../migrations') });
  repository = new DrizzleColumnMappingRepository(db);
});

beforeEach(async () => {
  await db.delete(spreadsheetConfigs);
  await db.delete(users);
  await db.insert(users).values([
    { userId, status: 'active' },
    { userId: otherUserId, status: 'active' },
  ]);
  await db.insert(spreadsheetConfigs).values([
    {
      id: spreadsheetId,
      userId,
      provider: 'google',
      fileId: 'file-1',
      fileName: 'Expenses',
      sheetName: 'T 6',
      accessVerifiedAt: new Date('2026-10-03T08:00:00Z'),
    },
    {
      id: otherSpreadsheetId,
      userId: otherUserId,
      provider: 'google',
      fileId: 'file-2',
      fileName: 'Other',
      sheetName: 'Sheet 1',
      accessVerifiedAt: new Date('2026-10-03T08:00:00Z'),
    },
  ]);
  await db.insert(columnMappings).values([
    {
      spreadsheetId,
      gasttoField: 'moneda',
      columnIndex: 0,
      columnHeader: '',
    },
    {
      spreadsheetId: otherSpreadsheetId,
      gasttoField: 'fecha',
      columnIndex: 0,
      columnHeader: 'Fecha',
    },
  ]);
});

afterAll(async () => {
  if (client) await client.end();
  if (container) await container.stop();
});

describePostgres('DrizzleColumnMappingRepository replacement (PostgreSQL)', () => {
  it('removes obsolete rows, supports column exchanges, confirms, and isolates spreadsheets', async () => {
    const confirmedAt = new Date('2026-10-03T09:00:00Z');
    await repository.replaceBySpreadsheetId(spreadsheetId, [
      {
        GasttoField: 'medio_pago',
        columnIndex: 0,
        columnHeader: '',
        inferred: false,
        confirmedAt,
      },
      {
        GasttoField: 'fecha',
        columnIndex: 1,
        columnHeader: 'Fecha',
        inferred: true,
        confirmedAt,
      },
    ]);

    expect(await repository.findBySpreadsheetId(spreadsheetId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          GasttoField: 'medio_pago',
          columnIndex: 0,
          confirmedAt,
        }),
        expect.objectContaining({ GasttoField: 'fecha', columnIndex: 1, confirmedAt }),
      ]),
    );
    expect(await repository.findBySpreadsheetId(otherSpreadsheetId)).toEqual([
      expect.objectContaining({ GasttoField: 'fecha', columnIndex: 0 }),
    ]);
  });

  it('rejects duplicate input and rolls back when insertion fails', async () => {
    await expect(
      repository.replaceBySpreadsheetId(spreadsheetId, [
        {
          GasttoField: 'moneda',
          columnIndex: 0,
          columnHeader: '',
          inferred: true,
          confirmedAt: null,
        },
        {
          GasttoField: 'medio_pago',
          columnIndex: 0,
          columnHeader: '',
          inferred: false,
          confirmedAt: null,
        },
      ]),
    ).rejects.toThrow('Duplicate spreadsheet column');

    await expect(
      repository.replaceBySpreadsheetId(spreadsheetId, [
        {
          GasttoField: 'medio_pago',
          columnIndex: 40_000,
          columnHeader: '',
          inferred: false,
          confirmedAt: null,
        },
      ]),
    ).rejects.toThrow();
    expect(await repository.findBySpreadsheetId(spreadsheetId)).toEqual([
      expect.objectContaining({ GasttoField: 'moneda', columnIndex: 0 }),
    ]);
  });
});
