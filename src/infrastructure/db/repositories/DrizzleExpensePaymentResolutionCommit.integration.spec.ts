import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { DrizzleExpensePaymentResolutionCommit } from './DrizzleExpensePaymentResolutionCommit';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { normalizeExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { DrizzleConversationStateRepository } from './DrizzleConversationStateRepository';
import { TransitionConversationState } from '../../../application/use-cases/conversation/TransitionConversationState';
import { CancelExpenseRegistrationUseCase } from '../../../application/use-cases/expense/CancelExpenseRegistrationUseCase';

const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const userId = '11111111-1111-4111-8111-111111111111';
const configId = '22222222-2222-4222-8222-222222222222';
const methodId = '33333333-3333-4333-8333-333333333333';
let container: StartedPostgreSqlContainer;
let client: postgres.Sql;
let db: PostgresJsDatabase<typeof schema>;

const current = (): ExpenseReviewPayload => ({
  rawMessage: 'Coffee 12 EUR with Visa',
  extracted: {
    monto: 12,
    moneda: 'EUR',
    categoriaRaw: 'Food',
    subcategoriaRaw: null,
    fechaRaw: '2026-10-26',
    medioPago: 'Visa',
    confianzaCategoria: 'alta',
    confianzaSubcategoria: 'nula',
  },
  resolvedDate: '2026-10-26',
  resolvedCategory: 'Food',
  resolvedCategoryId: null,
  categoryStatus: 'confirmed',
  resolvedSubcategory: null,
  resolvedSubcategoryId: null,
  subcategoryStatus: 'none',
  subcategoryEnabled: false,
  paymentMethodSelection: {
    status: 'unresolved',
    sourceConfigId: configId,
    paymentMethodId: null,
    canonicalName: null,
    unresolvedRaw: 'Visa',
  },
  reviewBinding: {
    operationId: 'abcdefghijklmnopqrstuv',
    revision: 2,
    presentedAt: '2026-10-26T10:00:00.000Z',
  },
});
const next = (review: ExpenseReviewPayload): ExpenseReviewPayload => ({
  ...review,
  paymentMethodSelection: {
    status: 'matched',
    sourceConfigId: configId,
    paymentMethodId: methodId,
    canonicalName: 'Visa',
    unresolvedRaw: null,
  },
  reviewBinding: { operationId: 'abcdefghijklmnopqrstuv', revision: 3, presentedAt: null },
});

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
    paymentMethodsConfirmedAt: new Date(),
  });
  await db.insert(schema.conversationStates).values({
    userId,
    currentState: 'EXPENSE_REVIEW',
    revision: 7n,
    expiresAt: new Date(Date.now() + 60_000),
    statePayload: current(),
  });
});
afterAll(async () => {
  if (client) await client.end();
  if (container) await container.stop();
});

describePostgres('expense payment resolution (PostgreSQL)', () => {
  it('keeps an explicit catalog addition after the expense review is cancelled', async () => {
    const review = normalizeExpenseReviewPayload(current());
    const result = await new DrizzleExpensePaymentResolutionCommit(db).execute({
      userId,
      expected: { revision: '7', currentState: 'EXPENSE_REVIEW', expiry: 'unexpired' },
      sourceConfigId: configId,
      current: review,
      next: next(review),
      action: { kind: 'add', paymentMethodId: methodId, name: 'Visa' },
    });
    expect(result).toMatchObject({ status: 'updated', state: { revision: '8' } });
    const methods = await db.select().from(schema.userPaymentMethods);
    expect(methods).toMatchObject([{ id: methodId, displayName: 'Visa', isActive: true }]);
    const [state] = await db
      .select()
      .from(schema.conversationStates)
      .where(eq(schema.conversationStates.userId, userId));
    expect(state?.statePayload).toMatchObject({
      reviewBinding: { revision: 3, presentedAt: null },
    });

    const transitionState = new TransitionConversationState(
      new DrizzleConversationStateRepository(db),
    );
    const sendMessage = vi.fn().mockResolvedValue({ status: 'success' });
    const cancellation = new CancelExpenseRegistrationUseCase({
      transitionState,
      messagingPort: { sendMessage },
    });
    await expect(
      transitionState.runForUser(userId, () =>
        cancellation.execute({
          userId,
          chatId: 'chat-1',
          currentState: 'EXPENSE_REVIEW',
          source: 'text',
        }),
      ),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(await db.select().from(schema.userPaymentMethods)).toMatchObject([
      { id: methodId, displayName: 'Visa', isActive: true },
    ]);
    const [cancelled] = await db
      .select()
      .from(schema.conversationStates)
      .where(eq(schema.conversationStates.userId, userId));
    expect(cancelled).toMatchObject({ currentState: 'IDLE', statePayload: null });
  });

  it('rolls back a forged next selection and rejects a repeated stale action', async () => {
    const review = normalizeExpenseReviewPayload(current());
    const forged = {
      ...next(review),
      paymentMethodSelection: {
        status: 'matched' as const,
        sourceConfigId: configId,
        paymentMethodId: methodId,
        canonicalName: 'Other',
        unresolvedRaw: null,
      },
    };
    const adapter = new DrizzleExpensePaymentResolutionCommit(db);
    const input = {
      userId,
      expected: { revision: '7', currentState: 'EXPENSE_REVIEW', expiry: 'unexpired' as const },
      sourceConfigId: configId,
      current: review,
      action: { kind: 'add' as const, paymentMethodId: methodId, name: 'Visa' },
    };
    await expect(adapter.execute({ ...input, next: forged })).resolves.toEqual({
      status: 'invalid',
    });
    expect(await db.select().from(schema.userPaymentMethods)).toHaveLength(0);
    await expect(adapter.execute({ ...input, next: next(review) })).resolves.toMatchObject({
      status: 'updated',
    });
    await expect(adapter.execute({ ...input, next: next(review) })).resolves.toEqual({
      status: 'stale',
    });
    expect(await db.select().from(schema.userPaymentMethods)).toHaveLength(1);
  });
});
