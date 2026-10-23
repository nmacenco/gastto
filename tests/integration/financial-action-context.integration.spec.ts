import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import Redis from 'ioredis';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as schema from '../../src/infrastructure/db/schema';
import {
  getConnectionString,
  isDockerAvailable,
  startDbContainer,
  stopDbContainer,
} from './helpers/db-container';
import { runMigrations } from './helpers/migrate';
import { createConversationState, createUser } from './helpers/fixtures';
import { DrizzleConversationStateRepository } from '../../src/infrastructure/db/repositories/DrizzleConversationStateRepository';
import { RedisUserProcessingLock } from '../../src/infrastructure/redis/RedisUserProcessingLock';
import { TransitionConversationState } from '../../src/application/use-cases/conversation/TransitionConversationState';
import { UndoLastExpenseUseCase } from '../../src/application/use-cases/expense/UndoLastExpense';
import type {
  IExpenseRecordRepository,
  IOperationLogRepository,
  ISpreadsheetConfigRepository,
} from '../../src/domain/ports/repositories';

describe.skipIf(!isDockerAvailable())('Integration :: financial action context', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  let sql: postgres.Sql;
  let redis: Redis;
  let repo: DrizzleConversationStateRepository;

  beforeAll(async () => {
    [postgresContainer, redisContainer] = await Promise.all([
      startDbContainer(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);
    sql = postgres(getConnectionString(postgresContainer), { max: 4 });
    await runMigrations(sql);
    repo = new DrizzleConversationStateRepository(drizzle(sql, { schema }));
    redis = new Redis(redisContainer.getMappedPort(6379), redisContainer.getHost(), {
      maxRetriesPerRequest: 1,
    });
  }, 120_000);

  afterAll(async () => {
    if (redis) redis.disconnect();
    if (sql) await sql.end();
    await Promise.all([
      postgresContainer ? stopDbContainer(postgresContainer) : Promise.resolve(),
      redisContainer ? redisContainer.stop() : Promise.resolve(),
    ]);
  });

  async function createState(
    currentState: 'IDLE' | 'EXPENSE_UNDO_CONFIRMING' | 'EXPENSE_SAVING_RETRY',
    statePayload: Record<string, unknown>,
    expiresAt: Date | null,
  ) {
    const db = drizzle(sql, { schema });
    const user = await createUser(db);
    await createConversationState(db, {
      userId: user.userId,
      currentState,
      statePayload,
      expiresAt,
    });
    return (await repo.findByUserId(user.userId))!;
  }

  const claim = (claimId: string, kind: 'undo' | 'retry', operationId = 'operation-1') => ({
    claimId,
    kind,
    operationId,
    sourceMessageId: 'message-1',
    status: 'in_flight',
    target: kind === 'undo' ? { expenseId: 'expense-1', rowIndex: 8 } : { attemptCount: 2 },
  });

  it('rejects delayed undo and retry claims at expiry before any external effect', async () => {
    const append = vi.fn();
    const deleteRow = vi.fn();
    for (const currentState of ['EXPENSE_UNDO_CONFIRMING', 'EXPENSE_SAVING_RETRY'] as const) {
      const observed = await createState(currentState, { operationId: currentState }, new Date(0));
      const result = await repo.transition({
        userId: observed.userId,
        expected: {
          revision: observed.revision,
          currentState,
          expiry: 'unexpired',
        },
        nextState: currentState === 'EXPENSE_UNDO_CONFIRMING' ? 'IDLE' : currentState,
        payload: {
          executionClaim: claim(
            `claim-${currentState}`,
            currentState === 'EXPENSE_UNDO_CONFIRMING' ? 'undo' : 'retry',
          ),
        },
        expiresAt: observed.expiresAt,
        claimId: `claim-${currentState}`,
      });
      expect(result.status).toBe('expired');
    }
    expect(append).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it('consumes immediate undo eligibility and concurrent delayed confirmation only once', async () => {
    const immediate = await createState('IDLE', { immediateUndoExpenseId: 'expense-1' }, null);
    const immediateExpected = {
      revision: immediate.revision,
      currentState: immediate.currentState,
      expiry: 'any' as const,
    };
    const immediateWrites = await Promise.all([
      repo.transition({
        userId: immediate.userId,
        expected: immediateExpected,
        nextState: 'IDLE',
        payload: null,
        expiresAt: null,
      }),
      repo.transition({
        userId: immediate.userId,
        expected: immediateExpected,
        nextState: 'IDLE',
        payload: null,
        expiresAt: null,
      }),
    ]);
    expect(immediateWrites.filter((result) => result.status === 'updated')).toHaveLength(1);

    const undo = await createState(
      'EXPENSE_UNDO_CONFIRMING',
      {
        pendingExpenseId: 'expense-1',
        actionBinding: {
          operationId: 'abcdefghijklmnopqrstuv',
          revision: 1,
          presentedAt: new Date(Date.now() - 1_000).toISOString(),
        },
      },
      new Date(Date.now() + 60_000),
    );
    const expected = {
      revision: undo.revision,
      currentState: undo.currentState,
      expiry: 'unexpired' as const,
    };
    const confirmations = await Promise.all([
      repo.transition({
        userId: undo.userId,
        expected,
        nextState: 'IDLE',
        payload: { executionClaim: claim('undo-a', 'undo') },
        expiresAt: null,
        claimId: 'undo-a',
      }),
      repo.transition({
        userId: undo.userId,
        expected,
        nextState: 'IDLE',
        payload: { executionClaim: claim('undo-b', 'undo') },
        expiresAt: null,
        claimId: 'undo-b',
      }),
    ]);
    expect(confirmations.filter((result) => result.status === 'updated')).toHaveLength(1);
  });

  it('rejects a replaced latest expense after consuming the exact undo authorization', async () => {
    const presentedAt = new Date(Date.now() - 1_000).toISOString();
    const observed = await createState(
      'EXPENSE_UNDO_CONFIRMING',
      {
        pendingExpenseId: 'expense-1',
        actionBinding: {
          operationId: 'abcdefghijklmnopqrstuv',
          revision: 1,
          presentedAt,
        },
      },
      new Date(Date.now() + 60_000),
    );
    const offered = {
      id: 'expense-1',
      userId: observed.userId,
      spreadsheetId: 'spreadsheet-1',
      concepto: 'Café',
      monto: 4.5,
      moneda: 'EUR' as const,
      categoria: 'Comida',
      categoryId: null,
      subcategoryId: null,
      subcategoria: null,
      fechaGasto: new Date('2026-09-13T00:00:00.000Z'),
      medioPago: null,
      sheetName: 'Gastos',
      rowIndex: 8,
      categoriaConfidence: 'alta' as const,
      rawMessage: 'Café 4.5 EUR',
      isDeleted: false,
      deletedAt: null,
      createdAt: new Date('2026-09-13T10:00:00.000Z'),
      savedAt: new Date('2026-09-13T10:00:00.000Z'),
    };
    const replacement = { ...offered, id: 'expense-2', rowIndex: 9 };
    const findLatestByUserId = vi
      .fn()
      .mockResolvedValueOnce(offered)
      .mockResolvedValueOnce(replacement);
    const deleteRow = vi.fn();
    const transitionState = new TransitionConversationState(repo);
    const useCase = new UndoLastExpenseUseCase(
      { create: () => ({ deleteRow }) },
      {
        findLatestByUserId,
        softDeleteWithAudit: vi.fn(),
      } as unknown as IExpenseRecordRepository,
      {
        findByUserId: vi.fn().mockResolvedValue({ provider: 'google', fileId: 'file-1' }),
      } as unknown as ISpreadsheetConfigRepository,
      { create: vi.fn() } as unknown as IOperationLogRepository,
      {
        getValidAccessToken: vi.fn(),
        forceRefreshAccessToken: vi.fn(),
      },
      transitionState,
    );

    const result = await transitionState.runWithState(observed, () =>
      useCase.execute({
        userId: observed.userId,
        action: 'confirm',
        pendingExpenseId: offered.id,
        authorization: {
          receivedAt: new Date(Date.parse(presentedAt) + 1).toISOString(),
          sourceMessageId: 'message-undo',
        },
      }),
    );

    expect(result.status).toBe('not_found');
    expect(deleteRow).not.toHaveBeenCalled();
    const persisted = (await repo.findByUserId(observed.userId))!;
    expect(persisted.currentState).toBe('IDLE');
    expect(persisted.statePayload).toBeNull();
  });

  it('keeps a retry claim across restart and blocks duplicate, timeout, and OAuth writers', async () => {
    const retry = await createState(
      'EXPENSE_SAVING_RETRY',
      { attemptCount: 1 },
      new Date(Date.now() + 60_000),
    );
    const claimed = await repo.transition({
      userId: retry.userId,
      expected: { revision: retry.revision, currentState: retry.currentState, expiry: 'unexpired' },
      nextState: 'EXPENSE_SAVING_RETRY',
      payload: { attemptCount: 1, executionClaim: claim('retry-1', 'retry') },
      expiresAt: retry.expiresAt,
      claimId: 'retry-1',
    });
    expect(claimed.status).toBe('updated');
    const restartedRepo = new DrizzleConversationStateRepository(drizzle(sql, { schema }));
    const persisted = (await restartedRepo.findByUserId(retry.userId))!;
    for (const nextState of ['EXPENSE_SAVING_RETRY', 'IDLE'] as const) {
      const competing = await restartedRepo.transition({
        userId: retry.userId,
        expected: {
          revision: persisted.revision,
          currentState: persisted.currentState,
          expiry: 'any',
        },
        nextState,
        payload: null,
        expiresAt: null,
      });
      expect(competing.status).toBe('operation_in_progress');
    }
    expect((persisted.statePayload!.executionClaim as { claimId: string }).claimId).toBe('retry-1');
  });

  it('retains unknown remote success until matching local finalization and never reports false success', async () => {
    const successMessage = vi.fn();
    const audit = vi.fn();
    const retry = await createState(
      'EXPENSE_SAVING_RETRY',
      { attemptCount: 1 },
      new Date(Date.now() + 60_000),
    );
    const claimed = await repo.transition({
      userId: retry.userId,
      expected: { revision: retry.revision, currentState: retry.currentState, expiry: 'unexpired' },
      nextState: 'EXPENSE_SAVING_RETRY',
      payload: {
        executionClaim: { ...claim('retry-unknown', 'retry'), status: 'outcome_unknown' },
      },
      expiresAt: retry.expiresAt,
      claimId: 'retry-unknown',
    });
    expect(claimed.status).toBe('updated');
    expect(successMessage).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    const snapshot = (await repo.findByUserId(retry.userId))!;
    const finalized = await repo.transition({
      userId: retry.userId,
      expected: { revision: snapshot.revision, currentState: snapshot.currentState, expiry: 'any' },
      nextState: 'IDLE',
      payload: null,
      expiresAt: null,
      claimId: 'retry-unknown',
    });
    expect(finalized.status).toBe('updated');
  });

  it('discards a future model proposal after revision change or lease loss with zero effects', async () => {
    const observed = await createState('IDLE', {}, null);
    const lock = new RedisUserProcessingLock(redis);
    const oldToken = (await lock.acquire(observed.userId, 10_000))!;
    let releaseProposal!: () => void;
    const proposalBoundary = new Promise<void>((resolve) => {
      releaseProposal = resolve;
    });
    const queue = vi.fn();
    const message = vi.fn();
    const append = vi.fn();
    const deletion = vi.fn();
    const proposal = (async () => {
      await proposalBoundary;
      const result = await repo.transition({
        userId: observed.userId,
        expected: {
          revision: observed.revision,
          currentState: observed.currentState,
          expiry: 'any',
        },
        nextState: 'EXPENSE_UNDO_CONFIRMING',
        payload: { proposed: true },
        expiresAt: new Date(Date.now() + 60_000),
      });
      if (result.status === 'updated') {
        await queue();
        await message();
        await append();
        await deletion();
      }
      return result.status;
    })();
    await repo.transition({
      userId: observed.userId,
      expected: { revision: observed.revision, currentState: observed.currentState, expiry: 'any' },
      nextState: 'IDLE',
      payload: { replacement: true },
      expiresAt: null,
    });
    await redis.del(`process-message:lock:${observed.userId}`);
    expect(await lock.renew(observed.userId, oldToken, 10_000)).toBe(false);
    releaseProposal();
    await expect(proposal).resolves.toBe('stale');
    expect(queue).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(deletion).not.toHaveBeenCalled();
  });
});
