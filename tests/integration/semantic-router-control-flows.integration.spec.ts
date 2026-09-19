import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/infrastructure/db/schema';
import {
  getConnectionString,
  isDockerAvailable,
  startDbContainer,
  stopDbContainer,
} from './helpers/db-container';
import { runMigrations } from './helpers/migrate';
import { createConversationState, createSpreadsheetConfig, createUser } from './helpers/fixtures';
import { DrizzleConversationStateRepository } from '../../src/infrastructure/db/repositories/DrizzleConversationStateRepository';
import { DrizzleExpenseQueueRepository } from '../../src/infrastructure/db/repositories/DrizzleExpenseQueueRepository';
import { DrizzleExpenseRecordRepository } from '../../src/infrastructure/db/repositories/DrizzleExpenseRecordRepository';
import { DrizzleSpreadsheetConfigRepository } from '../../src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository';
import { DrizzleOperationLogRepository } from '../../src/infrastructure/db/repositories/DrizzleOperationLogRepository';
import { RedisUserProcessingLock } from '../../src/infrastructure/redis/RedisUserProcessingLock';
import { TransitionConversationState } from '../../src/application/use-cases/conversation/TransitionConversationState';
import { ValidateConversationSnapshot } from '../../src/application/services/semantic-router/ValidateConversationSnapshot';
import { AdvancePendingExpense } from '../../src/application/use-cases/expense/AdvancePendingExpense';
import { CancelExpenseRegistrationUseCase } from '../../src/application/use-cases/expense/CancelExpenseRegistrationUseCase';
import { UndoLastExpenseUseCase } from '../../src/application/use-cases/expense/UndoLastExpense';
import { PresentUndoConfirmation } from '../../src/application/use-cases/expense/PresentUndoConfirmation';
import { DispatchControlSemanticAction } from '../../src/application/use-cases/expense/DispatchControlSemanticAction';
import { RetryExpenseSaveUseCase } from '../../src/application/use-cases/expense/RetryExpenseSaveUseCase';
import { StartSpreadsheetReconfigurationUseCase } from '../../src/application/use-cases/spreadsheet/StartSpreadsheetReconfigurationUseCase';

type Database = PostgresJsDatabase<typeof schema>;

describe.skipIf(!isDockerAvailable())('Integration :: semantic router control flows', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  let sql: postgres.Sql;
  let redis: Redis;
  let db: Database;

  beforeAll(async () => {
    [postgresContainer, redisContainer] = await Promise.all([
      startDbContainer(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);
    sql = postgres(getConnectionString(postgresContainer), { max: 6, onnotice: () => undefined });
    await runMigrations(sql);
    db = drizzle(sql, { schema });
    redis = new Redis(redisContainer.getMappedPort(6379), redisContainer.getHost(), {
      maxRetriesPerRequest: 1,
    });
  }, 120_000);

  beforeEach(async () => {
    await redis.flushdb();
    await sql.unsafe('truncate table users cascade');
  });

  afterAll(async () => {
    if (redis) redis.disconnect();
    if (sql) await sql.end();
    await Promise.all([
      postgresContainer ? stopDbContainer(postgresContainer) : Promise.resolve(),
      redisContainer ? redisContainer.stop() : Promise.resolve(),
    ]);
  });

  it('cancels only the captured revision and advances the oldest FIFO item', async () => {
    const user = await createUser(db);
    await createConversationState(db, {
      userId: user.userId,
      currentState: 'EXPENSE_RECEIVING',
      statePayload: { raw_message: 'Taxi 12 EUR' },
    });
    const stateRepo = new DrizzleConversationStateRepository(db);
    const queueRepo = new DrizzleExpenseQueueRepository(db);
    await queueRepo.enqueue(user.userId, 'Café 4 EUR', 'telegram');
    await queueRepo.enqueue(user.userId, 'Tren 25 EUR', 'telegram');
    const transitionState = new TransitionConversationState(stateRepo);
    const messages: string[] = [];
    const messaging = {
      sendMessage: vi.fn(async (_chatId: string, message: string) => {
        messages.push(message);
        return { status: 'success' as const };
      }),
    };
    const interpret = vi
      .fn()
      .mockResolvedValue({ status: 'needs_clarification', missingField: 'monto' });
    const advancePendingExpense = new AdvancePendingExpense({
      expenseQueueRepository: queueRepo,
      registerExpense: { interpret } as never,
      generateExpenseSummary: { execute: vi.fn() } as never,
      messagingPort: messaging,
      expenseSummaryPresenterFactory: vi.fn() as never,
    });
    const cancellation = new CancelExpenseRegistrationUseCase({
      transitionState,
      messagingPort: messaging,
      advancePendingExpense,
    });
    const observed = (await stateRepo.findByUserId(user.userId))!;
    const lock = new RedisUserProcessingLock(redis);
    const token = await lock.acquire(user.userId, 30_000);
    expect(token).not.toBeNull();

    await transitionState.runWithState(observed, () =>
      cancellation.execute({
        userId: user.userId,
        chatId: 'chat-1',
        currentState: 'EXPENSE_RECEIVING',
        source: 'semantic',
        channel: 'telegram',
        expected: transitionState.precondition(observed, 'unexpired'),
      }),
    );

    const persisted = (await stateRepo.findByUserId(user.userId))!;
    const queued = await queueRepo.findByUserId(user.userId);
    expect(persisted.currentState).toBe('IDLE');
    expect(persisted.statePayload).toBeNull();
    expect(queued.map((item) => item.rawMessage)).toEqual(['Tren 25 EUR']);
    expect(interpret).toHaveBeenCalledWith(
      expect.objectContaining({ rawMessage: 'Café 4 EUR', channel: 'telegram' }),
    );
    expect(messages[0]).toContain('Registro cancelado');
    await lock.release(user.userId, token!);
  });

  it('presents inferred undo despite immediate eligibility and performs no deletion', async () => {
    const harness = await buildUndoHarness({ immediateUndoExpenseId: 'placeholder' });
    const observed = (await harness.stateRepo.findByUserId(harness.userId))!;
    const expense = await harness.createExpense();
    await harness.stateRepo.transition({
      userId: harness.userId,
      expected: { revision: observed.revision, currentState: 'IDLE', expiry: 'any' },
      nextState: 'IDLE',
      payload: { immediateUndoExpenseId: expense.id },
      expiresAt: null,
    });
    const current = (await harness.stateRepo.findByUserId(harness.userId))!;

    const outcome = await harness.transitionState.runWithState(current, () =>
      harness.dispatcher.execute({
        userId: harness.userId,
        externalId: 'chat-1',
        channel: 'telegram',
        conversationState: current,
        expected: harness.transitionState.precondition(current, 'unexpired'),
        decision: { action: 'undo_last_expense' },
        provenance: { kind: 'semantic_proposal', sourceMessageId: 'message-semantic' },
      }),
    );

    expect(outcome).toEqual({
      status: 'undo_confirmation_presented',
      pendingExpenseId: expense.id,
    });
    expect(harness.deleteRow).not.toHaveBeenCalled();
    expect((await harness.expenseRepo.findLatestByUserId(harness.userId))?.id).toBe(expense.id);
    const confirming = (await harness.stateRepo.findByUserId(harness.userId))!;
    expect(confirming.currentState).toBe('EXPENSE_UNDO_CONFIRMING');
    expect(confirming.statePayload).toMatchObject({ pendingExpenseId: expense.id });
    expect(confirming.statePayload?.actionBinding).toMatchObject({
      presentedAt: expect.any(String),
    });
  });

  it('preserves direct deletion for the exact immediate deterministic undo command', async () => {
    const harness = await buildUndoHarness(null);
    const expense = await harness.createExpense();
    const observed = (await harness.stateRepo.findByUserId(harness.userId))!;
    await harness.stateRepo.transition({
      userId: harness.userId,
      expected: { revision: observed.revision, currentState: 'IDLE', expiry: 'any' },
      nextState: 'IDLE',
      payload: { immediateUndoExpenseId: expense.id },
      expiresAt: null,
    });
    const eligible = (await harness.stateRepo.findByUserId(harness.userId))!;

    const outcome = await harness.transitionState.runWithState(eligible, () =>
      harness.undo.execute({
        userId: harness.userId,
        action: 'request',
        provenance: 'deterministic_command',
        immediateExpenseId: expense.id,
      }),
    );

    expect(outcome.status).toBe('deleted');
    expect(harness.deleteRow).toHaveBeenCalledOnce();
    expect(await harness.expenseRepo.findLatestByUserId(harness.userId)).toBeNull();
  });

  it('allows only one concurrent exact confirmation after the semantic offer', async () => {
    const harness = await buildUndoHarness(null);
    const expense = await harness.createExpense();
    const idle = (await harness.stateRepo.findByUserId(harness.userId))!;
    await harness.transitionState.runWithState(idle, () =>
      harness.dispatcher.execute({
        userId: harness.userId,
        externalId: 'chat-1',
        channel: 'telegram',
        conversationState: idle,
        expected: harness.transitionState.precondition(idle, 'unexpired'),
        decision: { action: 'undo_last_expense' },
        provenance: { kind: 'semantic_proposal', sourceMessageId: 'message-semantic' },
      }),
    );
    const confirming = (await harness.stateRepo.findByUserId(harness.userId))!;
    const presentedAt = String(
      (confirming.statePayload?.actionBinding as Record<string, unknown>).presentedAt,
    );
    const confirm = () => {
      const transition = new TransitionConversationState(harness.stateRepo);
      return transition.runWithState(confirming, () =>
        new UndoLastExpenseUseCase(
          { create: () => ({ deleteRow: harness.deleteRow }) } as never,
          harness.expenseRepo,
          harness.configRepo,
          harness.logRepo,
          harness.oauth,
          transition,
        ).execute({
          userId: harness.userId,
          action: 'confirm',
          pendingExpenseId: expense.id,
          authorization: {
            receivedAt: new Date(Date.parse(presentedAt) + 1).toISOString(),
            sourceMessageId: randomUUID(),
          },
        }),
      );
    };

    const results = await Promise.allSettled([confirm(), confirm()]);
    expect(
      results.filter(
        (result) => result.status === 'fulfilled' && result.value.status === 'deleted',
      ),
    ).toHaveLength(1);
    expect(harness.deleteRow).toHaveBeenCalledOnce();
    expect(await harness.expenseRepo.findLatestByUserId(harness.userId)).toBeNull();
  });

  it('keeps semantic retry request-only and preserves the bound retry state', async () => {
    const user = await createUser(db);
    await createConversationState(db, {
      userId: user.userId,
      currentState: 'EXPENSE_SAVING_RETRY',
      statePayload: retryPayload(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const stateRepo = new DrizzleConversationStateRepository(db);
    const transitionState = new TransitionConversationState(stateRepo);
    const observed = (await stateRepo.findByUserId(user.userId))!;
    const dispatcher = new DispatchControlSemanticAction({
      snapshotValidator: new ValidateConversationSnapshot(
        stateRepo,
        (userId) => transitionState.currentState(userId) !== null,
      ),
      cancelExpenseRegistration: { execute: vi.fn() },
      undoLastExpense: { execute: vi.fn() },
      presentUndoConfirmation: { execute: vi.fn() },
      startSpreadsheetReconfiguration: { execute: vi.fn() },
    });

    const outcome = await transitionState.runWithState(observed, () =>
      dispatcher.execute({
        userId: user.userId,
        externalId: 'chat-1',
        channel: 'telegram',
        conversationState: observed,
        expected: transitionState.precondition(observed, 'unexpired'),
        decision: { action: 'request_save_retry' },
        provenance: { kind: 'semantic_proposal', sourceMessageId: 'message-semantic' },
      }),
    );

    expect(outcome).toEqual({ status: 'explicit_command_required', command: 'reintentar' });
    expect(await stateRepo.findByUserId(user.userId)).toEqual(observed);
  });

  it('allows one later exact retry append and rejects the repeated request', async () => {
    const user = await createUser(db);
    await createConversationState(db, {
      userId: user.userId,
      currentState: 'EXPENSE_SAVING_RETRY',
      statePayload: retryPayload(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const stateRepo = new DrizzleConversationStateRepository(db);
    const transitionState = new TransitionConversationState(stateRepo);
    const operationLogRepo = new DrizzleOperationLogRepository(db);
    const save = vi.fn().mockResolvedValue({ sheetName: 'Gastos', rowIndex: 9 });
    const retry = new RetryExpenseSaveUseCase({
      registerExpense: { save } as never,
      transitionState,
      messagingPort: { sendMessage: vi.fn().mockResolvedValue({ status: 'success' }) },
      operationLogRepo,
    });
    const observed = (await stateRepo.findByUserId(user.userId))!;
    const presentedAt = String(
      (observed.statePayload?.actionBinding as Record<string, unknown>).presentedAt,
    );
    const authorization = {
      receivedAt: new Date(Date.parse(presentedAt) + 1).toISOString(),
      sourceMessageId: randomUUID(),
    };

    const first = await transitionState.runWithState(observed, () =>
      retry.execute({ userId: user.userId, chatId: 'chat-1', authorization }),
    );
    const claimed = (await stateRepo.findByUserId(user.userId))!;
    const second = await transitionState.runWithState(claimed, () =>
      retry.execute({
        userId: user.userId,
        chatId: 'chat-1',
        authorization: { ...authorization, sourceMessageId: randomUUID() },
      }),
    );

    expect(first).toEqual({ status: 'handled' });
    expect(second).toEqual({ status: 'operation_in_progress' });
    expect(save).toHaveBeenCalledOnce();
  });

  it('reconfigures only the captured retry revision and does not replay the expense', async () => {
    const user = await createUser(db);
    await createSpreadsheetConfig(db, { userId: user.userId });
    await createConversationState(db, {
      userId: user.userId,
      currentState: 'EXPENSE_SAVING_RETRY',
      statePayload: retryPayload(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const stateRepo = new DrizzleConversationStateRepository(db);
    const configRepo = new DrizzleSpreadsheetConfigRepository(db);
    const transitionState = new TransitionConversationState(stateRepo);
    const validate = vi.fn().mockResolvedValue(undefined);
    const reconfiguration = new StartSpreadsheetReconfigurationUseCase({
      spreadsheetConfigRepository: configRepo,
      transitionState,
      validateSpreadsheetAccess: { execute: validate } as never,
      messagingPort: { sendMessage: vi.fn().mockResolvedValue({ status: 'success' }) },
    });
    const observed = (await stateRepo.findByUserId(user.userId))!;
    const dispatcher = new DispatchControlSemanticAction({
      snapshotValidator: new ValidateConversationSnapshot(
        stateRepo,
        (userId) => transitionState.currentState(userId) !== null,
      ),
      cancelExpenseRegistration: { execute: vi.fn() },
      undoLastExpense: { execute: vi.fn() },
      presentUndoConfirmation: { execute: vi.fn() },
      startSpreadsheetReconfiguration: reconfiguration,
    });

    const outcome = await transitionState.runWithState(observed, () =>
      dispatcher.execute({
        userId: user.userId,
        externalId: 'chat-1',
        channel: 'whatsapp',
        conversationState: observed,
        expected: transitionState.precondition(observed, 'unexpired'),
        decision: { action: 'request_reconfiguration' },
        provenance: { kind: 'semantic_proposal', sourceMessageId: 'message-semantic' },
      }),
    );

    expect(outcome).toEqual({ status: 'reconfiguration_started' });
    expect((await stateRepo.findByUserId(user.userId))?.currentState).toBe(
      'ONBOARDING_VALIDATING_ACCESS',
    );
    expect(validate).toHaveBeenCalledOnce();
  });

  async function buildUndoHarness(initialPayload: Record<string, unknown> | null) {
    const user = await createUser(db);
    const config = await createSpreadsheetConfig(db, { userId: user.userId });
    await createConversationState(db, { userId: user.userId, statePayload: initialPayload });
    const stateRepo = new DrizzleConversationStateRepository(db);
    const expenseRepo = new DrizzleExpenseRecordRepository(db);
    const configRepo = new DrizzleSpreadsheetConfigRepository(db);
    const logRepo = new DrizzleOperationLogRepository(db);
    const transitionState = new TransitionConversationState(stateRepo);
    const snapshotValidator = new ValidateConversationSnapshot(
      stateRepo,
      (userId) => transitionState.currentState(userId) !== null,
    );
    const deleteRow = vi.fn().mockResolvedValue(undefined);
    const oauth = {
      getValidAccessToken: vi.fn().mockResolvedValue({
        accessToken: 'token',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        refreshed: false,
      }),
      forceRefreshAccessToken: vi.fn(),
    };
    const undo = new UndoLastExpenseUseCase(
      { create: () => ({ deleteRow }) } as never,
      expenseRepo,
      configRepo,
      logRepo,
      oauth,
      transitionState,
    );
    const presenter = new PresentUndoConfirmation({
      transitionState,
      messagingPort: { sendMessage: vi.fn().mockResolvedValue({ status: 'success' }) },
    });
    const dispatcher = new DispatchControlSemanticAction({
      snapshotValidator,
      cancelExpenseRegistration: { execute: vi.fn() },
      undoLastExpense: undo,
      presentUndoConfirmation: presenter,
      startSpreadsheetReconfiguration: null,
    });
    return {
      userId: user.userId,
      stateRepo,
      expenseRepo,
      configRepo,
      logRepo,
      transitionState,
      dispatcher,
      undo,
      deleteRow,
      oauth,
      createExpense: () =>
        expenseRepo.create({
          userId: user.userId,
          spreadsheetId: config.id,
          concepto: 'Café',
          monto: 4.5,
          moneda: 'EUR',
          categoria: 'Comida',
          categoryId: null,
          subcategoryId: null,
          subcategoria: null,
          fechaGasto: new Date('2026-09-19T00:00:00.000Z'),
          medioPago: null,
          sheetName: 'Gastos',
          rowIndex: 8,
          categoriaConfidence: 'alta',
          rawMessage: 'Café 4.5 EUR',
          isDeleted: false,
          deletedAt: null,
        }),
    };
  }
});

function retryPayload(): Record<string, unknown> {
  return {
    expense: {
      rawMessage: 'Café 4.5 EUR',
      extracted: {
        monto: 4.5,
        moneda: 'EUR',
        categoriaRaw: 'Comida',
        subcategoriaRaw: null,
        fechaRaw: '2026-09-19',
        medioPago: null,
        confianzaCategoria: 'alta',
        confianzaSubcategoria: 'nula',
      },
      resolvedDate: '2026-09-19',
      resolvedCategory: 'Comida',
      resolvedCategoryId: null,
      categoryStatus: 'confirmed',
    },
    failureCode: 'NETWORK_ERROR',
    firstAttemptAt: '2026-09-19T10:00:00.000Z',
    attemptCount: 1,
    actionBinding: {
      operationId: 'abcdefghijklmnopqrstuv',
      revision: 1,
      presentedAt: '2026-09-19T10:01:00.000Z',
    },
  };
}
