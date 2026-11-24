import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { DrizzleExpenseCategoryChoiceCommit } from './DrizzleExpenseCategoryChoiceCommit';
import type { ExpenseCategoryChoiceState } from '../../../application/use-cases/expense/ExpenseCategoryChoiceState';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { advanceExpenseReviewBinding } from '../../../domain/value-objects/expense-review-binding';

const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const userId = '11111111-1111-4111-8111-111111111111';
const configId = '22222222-2222-4222-8222-222222222222';
const existingId = '33333333-3333-4333-8333-333333333333';
const newId = '44444444-4444-4444-8444-444444444444';
let container: StartedPostgreSqlContainer;
let client: postgres.Sql;
let db: PostgresJsDatabase<typeof schema>;

const original = (): ExpenseReviewPayload => ({
  rawMessage: 'Cafe 12 EUR',
  extracted: {
    monto: 12,
    moneda: 'EUR',
    categoriaRaw: 'Comida',
    subcategoriaRaw: null,
    fechaRaw: null,
    medioPago: null,
    confianzaCategoria: 'alta',
    confianzaSubcategoria: 'nula',
  },
  resolvedDate: '2026-11-23',
  resolvedCategory: 'Comida',
  resolvedCategoryId: existingId,
  categoryStatus: 'confirmed',
  resolvedSubcategory: null,
  resolvedSubcategoryId: null,
  subcategoryStatus: 'none',
  subcategoryEnabled: false,
  reviewBinding: {
    operationId: 'abcdefghijklmnopqrstuv',
    revision: 1,
    presentedAt: '2026-11-23T10:00:00.000Z',
  },
});
const choice = (): ExpenseCategoryChoiceState => ({
  _type: 'ExpenseCategoryChoice',
  choiceId: '55555555-5555-4555-8555-555555555555',
  stage: 'confirm',
  attemptedName: 'Mascotas',
  suggestedName: null,
  sourceConfigId: configId,
  baseline: {
    categories: [{ id: existingId, name: 'Comida', normalizedName: 'comida', isActive: true }],
    subcategories: [],
  },
  original: original(),
  proposed: { ...original(), extracted: { ...original().extracted, monto: 25 } },
  correctionCycles: 0,
});
const next = (): ExpenseReviewPayload => ({
  ...choice().proposed,
  extracted: { ...choice().proposed.extracted, categoriaRaw: 'Mascotas' },
  resolvedCategory: 'Mascotas',
  resolvedCategoryId: newId,
  categoryStatus: 'confirmed',
  reviewBinding: advanceExpenseReviewBinding(original().reviewBinding),
});

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  client = postgres(container.getConnectionUri(), { max: 5 });
  await client`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../migrations') });
});
beforeEach(async () => {
  await db.delete(schema.conversationStates);
  await db.delete(schema.userCategories);
  await db.delete(schema.spreadsheetConfigs);
  await db.delete(schema.users);
  await db.insert(schema.users).values({ userId, status: 'active' });
  await db.insert(schema.spreadsheetConfigs).values({
    id: configId,
    userId,
    provider: 'google',
    fileId: 'file',
    fileName: 'File',
    sheetName: 'Sheet',
    accessVerifiedAt: new Date(),
    categoriesConfirmedAt: new Date(),
  });
  await db.insert(schema.userCategories).values({
    id: existingId,
    spreadsheetId: configId,
    rawValue: 'Comida',
    normalizedValue: 'comida',
  });
  await db.insert(schema.conversationStates).values({
    userId,
    currentState: 'EXPENSE_CORRECTING',
    revision: 7n,
    expiresAt: new Date(Date.now() + 60_000),
    statePayload: choice(),
  });
});
afterAll(async () => {
  if (client) await client.end();
  if (container) await container.stop();
});

describePostgres('expense category choice commit (PostgreSQL)', () => {
  it('atomically adds a category and returns the same expense to review', async () => {
    const commit = new DrizzleExpenseCategoryChoiceCommit(db);
    const result = await commit.execute({
      userId,
      expected: { revision: '7', currentState: 'EXPENSE_CORRECTING', expiry: 'unexpired' },
      choice: choice(),
      selected: { id: newId, name: 'Mascotas', add: true },
      next: next(),
    });
    expect(result).toMatchObject({
      status: 'updated',
      state: { currentState: 'EXPENSE_REVIEW', revision: '8' },
    });
    expect(await db.select().from(schema.userCategories)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: newId, rawValue: 'Mascotas', isActive: true }),
      ]),
    );
    expect((await db.select().from(schema.conversationStates))[0]).toMatchObject({
      currentState: 'EXPENSE_REVIEW',
      statePayload: { extracted: { monto: 25 }, resolvedCategoryId: newId },
    });
    expect(await db.select().from(schema.expenseRecords)).toHaveLength(0);
    expect(
      await commit.execute({
        userId,
        expected: { revision: '7', currentState: 'EXPENSE_CORRECTING', expiry: 'unexpired' },
        choice: choice(),
        selected: { id: newId, name: 'Mascotas', add: true },
        next: next(),
      }),
    ).toEqual({ status: 'stale' });
    expect(
      (await db.select().from(schema.userCategories)).filter(
        (row) => row.normalizedValue === 'mascotas',
      ),
    ).toHaveLength(1);
  });

  it('rejects a catalog conflict without a partial review transition', async () => {
    await db.insert(schema.userCategories).values({
      id: newId,
      spreadsheetId: configId,
      rawValue: 'Mascotas',
      normalizedValue: 'mascotas',
    });
    const result = await new DrizzleExpenseCategoryChoiceCommit(db).execute({
      userId,
      expected: { revision: '7', currentState: 'EXPENSE_CORRECTING', expiry: 'unexpired' },
      choice: choice(),
      selected: { id: newId, name: 'Mascotas', add: true },
      next: next(),
    });
    expect(result).toEqual({ status: 'conflict' });
    expect(
      (
        await db
          .select()
          .from(schema.conversationStates)
          .where(eq(schema.conversationStates.userId, userId))
      )[0]?.currentState,
    ).toBe('EXPENSE_CORRECTING');
  });

  it('rejects expired choices without writing to the catalog', async () => {
    await db
      .update(schema.conversationStates)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(schema.conversationStates.userId, userId));
    expect(
      await new DrizzleExpenseCategoryChoiceCommit(db).execute({
        userId,
        expected: { revision: '7', currentState: 'EXPENSE_CORRECTING', expiry: 'unexpired' },
        choice: choice(),
        selected: { id: newId, name: 'Mascotas', add: true },
        next: next(),
      }),
    ).toEqual({ status: 'stale' });
    expect(await db.select().from(schema.userCategories)).toHaveLength(1);
  });

  it('reactivates a reserved inactive name with its original ID', async () => {
    await db.insert(schema.userCategories).values({
      id: newId,
      spreadsheetId: configId,
      rawValue: 'Mascotas',
      normalizedValue: 'mascotas',
      isActive: false,
    });
    const pending = {
      ...choice(),
      baseline: {
        ...choice().baseline,
        categories: [
          ...choice().baseline.categories,
          { id: newId, name: 'Mascotas', normalizedName: 'mascotas', isActive: false },
        ],
      },
    };
    await db
      .update(schema.conversationStates)
      .set({ statePayload: pending })
      .where(eq(schema.conversationStates.userId, userId));
    expect(
      await new DrizzleExpenseCategoryChoiceCommit(db).execute({
        userId,
        expected: { revision: '7', currentState: 'EXPENSE_CORRECTING', expiry: 'unexpired' },
        choice: pending,
        selected: { id: newId, name: 'Mascotas', add: true },
        next: next(),
      }),
    ).toMatchObject({ status: 'updated' });
    expect(
      (await db.select().from(schema.userCategories).where(eq(schema.userCategories.id, newId)))[0],
    ).toMatchObject({ id: newId, isActive: true });
  });

  it('rolls back a category insert when the next review is invalid', async () => {
    const invalidNext = { ...next(), resolvedCategory: 'Otra' };
    expect(
      await new DrizzleExpenseCategoryChoiceCommit(db).execute({
        userId,
        expected: { revision: '7', currentState: 'EXPENSE_CORRECTING', expiry: 'unexpired' },
        choice: choice(),
        selected: { id: newId, name: 'Mascotas', add: true },
        next: invalidNext,
      }),
    ).toEqual({ status: 'conflict' });
    expect(await db.select().from(schema.userCategories)).toHaveLength(1);
    expect((await db.select().from(schema.conversationStates))[0]?.currentState).toBe(
      'EXPENSE_CORRECTING',
    );
  });

  it('rejects a stale choice ID or financial execution claim', async () => {
    const commit = new DrizzleExpenseCategoryChoiceCommit(db);
    expect(
      await commit.execute({
        userId,
        expected: { revision: '7', currentState: 'EXPENSE_CORRECTING', expiry: 'unexpired' },
        choice: { ...choice(), choiceId: 'other-choice' },
        selected: { id: newId, name: 'Mascotas', add: true },
        next: next(),
      }),
    ).toEqual({ status: 'stale' });
    await db
      .update(schema.conversationStates)
      .set({ statePayload: { ...choice(), executionClaim: { claimId: 'claim' } } })
      .where(eq(schema.conversationStates.userId, userId));
    expect(
      await commit.execute({
        userId,
        expected: { revision: '7', currentState: 'EXPENSE_CORRECTING', expiry: 'unexpired' },
        choice: choice(),
        selected: { id: newId, name: 'Mascotas', add: true },
        next: next(),
      }),
    ).toEqual({ status: 'stale' });
    expect(await db.select().from(schema.userCategories)).toHaveLength(1);
  });
});
