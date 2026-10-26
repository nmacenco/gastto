import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { DrizzleSettingsVocabularyCommit } from './DrizzleSettingsVocabularyCommit';
import type {
  PaymentSnapshot,
  VocabularySnapshot,
} from '../../../application/ports/SettingsVocabularyCommit';

const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const userId = '11111111-1111-4111-8111-111111111111';
const configId = '22222222-2222-4222-8222-222222222222';
const categoryId = '33333333-3333-4333-8333-333333333333';
const childId = '44444444-4444-4444-8444-444444444444';
const expenseId = '55555555-5555-4555-8555-555555555555';
const flowId = '66666666-6666-4666-8666-666666666666';
const paymentId = '88888888-8888-4888-8888-888888888888';
let container: StartedPostgreSqlContainer;
let client: postgres.Sql;
let db: PostgresJsDatabase<typeof schema>;
const baseline = (): VocabularySnapshot => ({
  categories: [{ id: categoryId, name: 'Food', normalizedName: 'food', isActive: true }],
  subcategories: [
    { id: childId, categoryId, name: 'Restaurant', normalizedName: 'restaurant', isActive: true },
  ],
});
const input = (draft: VocabularySnapshot) => ({
  kind: 'categories' as const,
  userId,
  expected: { revision: '3', currentState: 'SETTINGS_MENU', expiry: 'unexpired' as const },
  flowId,
  sourceConfigId: configId,
  baseline: baseline(),
  draft,
});
const paymentBaseline = (): PaymentSnapshot => ({
  confirmed: true,
  methods: [{ id: paymentId, name: 'Card', normalizedName: 'card', isActive: true }],
});
const paymentInput = (draft: PaymentSnapshot) => ({
  kind: 'payment_methods' as const,
  userId,
  expected: { revision: '3', currentState: 'SETTINGS_MENU', expiry: 'unexpired' as const },
  flowId,
  sourceConfigId: configId,
  baseline: paymentBaseline(),
  draft,
});

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  client = postgres(container.getConnectionUri(), { max: 5 });
  await client`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../migrations') });
});
beforeEach(async () => {
  await db.delete(schema.expenseRecords);
  await db.delete(schema.conversationStates);
  await db.delete(schema.userPaymentMethods);
  await db.delete(schema.userSubcategories);
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
  await db
    .insert(schema.userCategories)
    .values({ id: categoryId, spreadsheetId: configId, rawValue: 'Food', normalizedValue: 'food' });
  await db
    .insert(schema.userSubcategories)
    .values({ id: childId, categoryId, rawValue: 'Restaurant', normalizedValue: 'restaurant' });
});
afterAll(async () => {
  if (client) await client.end();
  if (container) await container.stop();
});
async function open(draft: VocabularySnapshot) {
  await db.insert(schema.conversationStates).values({
    userId,
    currentState: 'SETTINGS_MENU',
    revision: 3n,
    expiresAt: new Date(Date.now() + 60_000),
    statePayload: {
      screen: 'categories',
      flowId,
      sourceConfigId: configId,
      baseline: baseline(),
      draft,
    },
  });
}
async function openPayments(draft: PaymentSnapshot) {
  await db.insert(schema.conversationStates).values({
    userId,
    currentState: 'SETTINGS_MENU',
    revision: 3n,
    expiresAt: new Date(Date.now() + 60_000),
    statePayload: {
      screen: 'payment_methods',
      flowId,
      sourceConfigId: configId,
      baseline: paymentBaseline(),
      draft,
    },
  });
}

describePostgres('settings category commit (PostgreSQL)', () => {
  it('preserves stable ids and historical snapshots while exiting atomically', async () => {
    await db.insert(schema.expenseRecords).values({
      id: expenseId,
      userId,
      spreadsheetId: configId,
      concepto: 'Dinner',
      monto: '24.50',
      moneda: 'EUR',
      categoria: 'Food',
      subcategoria: 'Restaurant',
      categoryId,
      subcategoryId: childId,
      fechaGasto: '2026-10-26',
      medioPago: null,
      sheetName: 'Sheet',
      rowIndex: 2,
      categoriaConfidence: 'alta',
      rawMessage: 'Dinner 24.50 EUR',
    });
    const draft = baseline();
    draft.categories[0]!.name = 'Meals';
    draft.categories[0]!.normalizedName = 'meals';
    await open(draft);
    const outcome = await new DrizzleSettingsVocabularyCommit(db).execute(input(draft));
    expect(outcome).toBe('committed');
    expect((await db.select().from(schema.userCategories))[0]).toMatchObject({
      id: categoryId,
      rawValue: 'Meals',
    });
    expect((await db.select().from(schema.expenseRecords))[0]).toMatchObject({
      categoryId,
      subcategoryId: childId,
      categoria: 'Food',
      subcategoria: 'Restaurant',
    });
    expect((await db.select().from(schema.conversationStates))[0]).toMatchObject({
      currentState: 'IDLE',
      statePayload: null,
    });
  });

  it('rejects baseline conflict without modifying the active catalog', async () => {
    const draft = baseline();
    draft.categories[0]!.name = 'Meals';
    draft.categories[0]!.normalizedName = 'meals';
    await open(draft);
    await db
      .update(schema.userCategories)
      .set({ rawValue: 'Changed', normalizedValue: 'changed' })
      .where(eq(schema.userCategories.id, categoryId));
    expect(await new DrizzleSettingsVocabularyCommit(db).execute(input(draft))).toBe('conflict');
    expect((await db.select().from(schema.userCategories))[0]?.rawValue).toBe('Changed');
    expect((await db.select().from(schema.conversationStates))[0]?.currentState).toBe(
      'SETTINGS_MENU',
    );
  });

  it('rolls back parent updates when a child insert fails', async () => {
    const draft = baseline();
    draft.categories[0]!.name = 'Meals';
    draft.categories[0]!.normalizedName = 'meals';
    draft.subcategories.push({
      id: '77777777-7777-4777-8777-777777777777',
      categoryId,
      name: 'Lunch',
      normalizedName: 'lunch',
      isActive: true,
    });
    await open(draft);
    await client.unsafe(
      "CREATE FUNCTION reject_settings_child_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'child failed'; END $$",
    );
    await client.unsafe(
      'CREATE TRIGGER reject_settings_child_insert BEFORE INSERT ON user_subcategories FOR EACH ROW EXECUTE FUNCTION reject_settings_child_insert()',
    );
    try {
      await expect(new DrizzleSettingsVocabularyCommit(db).execute(input(draft))).rejects.toThrow(
        'child failed',
      );
    } finally {
      await client.unsafe('DROP TRIGGER reject_settings_child_insert ON user_subcategories');
      await client.unsafe('DROP FUNCTION reject_settings_child_insert()');
    }
    expect((await db.select().from(schema.userCategories))[0]?.rawValue).toBe('Food');
    expect((await db.select().from(schema.conversationStates))[0]?.currentState).toBe(
      'SETTINGS_MENU',
    );
  });

  it('rejects a stale revision without changing the catalog', async () => {
    const draft = baseline();
    draft.categories[0]!.name = 'Meals';
    draft.categories[0]!.normalizedName = 'meals';
    await open(draft);
    await db
      .update(schema.conversationStates)
      .set({ revision: 4n })
      .where(eq(schema.conversationStates.userId, userId));
    expect(await new DrizzleSettingsVocabularyCommit(db).execute(input(draft))).toBe('stale');
    expect((await db.select().from(schema.userCategories))[0]?.rawValue).toBe('Food');
  });
});

describePostgres('settings payment commit (PostgreSQL)', () => {
  beforeEach(async () => {
    await db
      .update(schema.spreadsheetConfigs)
      .set({ paymentMethodsConfirmedAt: new Date() })
      .where(eq(schema.spreadsheetConfigs.id, configId));
    await db.insert(schema.userPaymentMethods).values({
      id: paymentId,
      spreadsheetId: configId,
      displayName: 'Card',
      normalizedName: 'card',
      isActive: true,
    });
  });

  it('renames by stable id and keeps the historical expense snapshot', async () => {
    await db.insert(schema.expenseRecords).values({
      id: expenseId,
      userId,
      spreadsheetId: configId,
      concepto: 'Dinner',
      monto: '24.50',
      moneda: 'EUR',
      categoria: 'Food',
      subcategoria: 'Restaurant',
      fechaGasto: '2026-10-26',
      medioPago: 'Card',
      paymentMethodId: paymentId,
      sheetName: 'Sheet',
      rowIndex: 2,
      categoriaConfidence: 'alta',
      rawMessage: 'Dinner 24.50 EUR',
    });
    const draft = paymentBaseline();
    draft.methods[0]!.name = 'Debit card';
    draft.methods[0]!.normalizedName = 'debit card';
    await openPayments(draft);
    expect(await new DrizzleSettingsVocabularyCommit(db).execute(paymentInput(draft))).toBe(
      'committed',
    );
    expect((await db.select().from(schema.userPaymentMethods))[0]).toMatchObject({
      id: paymentId,
      displayName: 'Debit card',
    });
    expect((await db.select().from(schema.expenseRecords))[0]).toMatchObject({
      paymentMethodId: paymentId,
      medioPago: 'Card',
    });
    expect((await db.select().from(schema.conversationStates))[0]?.currentState).toBe('IDLE');
  });

  it('rejects a changed baseline without partially applying the draft', async () => {
    const draft = paymentBaseline();
    draft.methods[0]!.name = 'Debit card';
    draft.methods[0]!.normalizedName = 'debit card';
    await openPayments(draft);
    await db
      .update(schema.userPaymentMethods)
      .set({ displayName: 'Cash', normalizedName: 'cash' })
      .where(eq(schema.userPaymentMethods.id, paymentId));
    expect(await new DrizzleSettingsVocabularyCommit(db).execute(paymentInput(draft))).toBe(
      'conflict',
    );
    expect((await db.select().from(schema.userPaymentMethods))[0]?.displayName).toBe('Cash');
    expect((await db.select().from(schema.conversationStates))[0]?.currentState).toBe(
      'SETTINGS_MENU',
    );
  });
});
