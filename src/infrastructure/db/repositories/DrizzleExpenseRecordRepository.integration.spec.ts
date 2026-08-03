// LAYER: Infrastructure / Integration Tests
// Verifies the undo persistence invariants against PostgreSQL and the real Drizzle migrations.

import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../schema';
import { expenseRecords, operationLogs, spreadsheetConfigs, users } from '../schema';
import { DrizzleExpenseRecordRepository } from './DrizzleExpenseRecordRepository';

const userId = '11111111-1111-4111-8111-111111111111';
const spreadsheetId = '22222222-2222-4222-8222-222222222222';

let container: StartedPostgreSqlContainer;
let client: postgres.Sql;
let db: PostgresJsDatabase<typeof schema>;
let repository: DrizzleExpenseRecordRepository;
const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  client = postgres(container.getConnectionUri(), { max: 1 });
  await client`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../migrations'),
  });
  repository = new DrizzleExpenseRecordRepository(db);
});

beforeEach(async () => {
  await db.delete(operationLogs);
  await db.delete(expenseRecords);
  await db.delete(spreadsheetConfigs);
  await db.delete(users);

  await db.insert(users).values({ userId, status: 'active' });
  await db.insert(spreadsheetConfigs).values({
    id: spreadsheetId,
    userId,
    provider: 'google',
    fileId: 'file-1',
    fileName: 'Expenses',
    sheetName: 'Gastos',
    accessVerifiedAt: new Date('2026-08-02T09:00:00Z'),
  });
});

afterAll(async () => {
  if (client) await client.end();
  if (container) await container.stop();
});

function expense(id: string, savedAt: Date, isDeleted = false) {
  return {
    id,
    userId,
    spreadsheetId,
    concepto: id,
    monto: '10.00',
    moneda: 'EUR' as const,
    categoria: null,
    fechaGasto: '2026-08-02',
    medioPago: null,
    sheetName: 'Gastos',
    rowIndex: 2,
    categoriaConfidence: null,
    rawMessage: id,
    isDeleted,
    deletedAt: isDeleted ? new Date('2026-08-02T09:00:00Z') : null,
    savedAt,
  };
}

describePostgres('DrizzleExpenseRecordRepository (PostgreSQL)', () => {
  it('selects only the latest non-deleted expense', async () => {
    await db.insert(expenseRecords).values([
      expense('33333333-3333-4333-8333-333333333333', new Date('2026-08-02T10:00:00Z')),
      expense('44444444-4444-4444-8444-444444444444', new Date('2026-08-02T11:00:00Z'), true),
      expense('55555555-5555-4555-8555-555555555555', new Date('2026-08-02T12:00:00Z')),
    ]);

    await expect(repository.findLatestByUserId(userId)).resolves.toMatchObject({
      id: '55555555-5555-4555-8555-555555555555',
      isDeleted: false,
    });
  });

  it('preserves the active record and writes no audit entry when the local undo mutation fails', async () => {
    const activeId = '66666666-6666-4666-8666-666666666666';
    await db.insert(expenseRecords).values(expense(activeId, new Date('2026-08-02T12:00:00Z')));

    await expect(
      repository.softDeleteWithAudit('77777777-7777-4777-8777-777777777777', userId, {
        expenseId: activeId,
      }),
    ).rejects.toThrow('Failed to soft-delete expense record');

    await expect(repository.findLatestByUserId(userId)).resolves.toMatchObject({
      id: activeId,
      isDeleted: false,
    });
    await expect(db.select().from(operationLogs)).resolves.toHaveLength(0);
  });

  it('soft-deletes the selected record and writes its audit entry atomically', async () => {
    const deletedId = '88888888-8888-4888-8888-888888888888';
    const remainingId = '99999999-9999-4999-8999-999999999999';
    await db.insert(expenseRecords).values([
      expense(deletedId, new Date('2026-08-02T12:00:00Z')),
      expense(remainingId, new Date('2026-08-02T11:00:00Z')),
    ]);

    await repository.softDeleteWithAudit(deletedId, userId, { expenseId: deletedId });

    await expect(repository.findLatestByUserId(userId)).resolves.toMatchObject({ id: remainingId });
    await expect(db.select().from(operationLogs)).resolves.toContainEqual(
      expect.objectContaining({ userId, operation: 'EXPENSE_DELETED', payload: { expenseId: deletedId } }),
    );
  });
});
