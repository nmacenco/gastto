import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Job, Queue } from 'bullmq';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import * as schema from '../../src/infrastructure/db/schema';
import {
  getConnectionString,
  isDockerAvailable,
  startDbContainer,
  stopDbContainer,
} from './helpers/db-container';
import { runMigrations } from './helpers/migrate';
import {
  createConversationState,
  createMessagingIdentity,
  createSpreadsheetConfig,
  createUser,
} from './helpers/fixtures';
import { DrizzleConversationStateRepository } from '../../src/infrastructure/db/repositories/DrizzleConversationStateRepository';
import { DrizzleUserRepository } from '../../src/infrastructure/db/repositories/DrizzleUserRepository';
import { DrizzleUserProfileRepository } from '../../src/infrastructure/db/repositories/DrizzleUserProfileRepository';
import { DrizzleSpreadsheetConfigRepository } from '../../src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository';
import { DrizzleColumnMappingRepository } from '../../src/infrastructure/db/repositories/DrizzleColumnMappingRepository';
import { DrizzleExpenseRecordRepository } from '../../src/infrastructure/db/repositories/DrizzleExpenseRecordRepository';
import { DrizzleExpenseQueueRepository } from '../../src/infrastructure/db/repositories/DrizzleExpenseQueueRepository';
import { DrizzleOperationLogRepository } from '../../src/infrastructure/db/repositories/DrizzleOperationLogRepository';
import { RedisProcessedMessageRepository } from '../../src/infrastructure/redis/RedisProcessedMessageRepository';
import { RedisUserProcessingLock } from '../../src/infrastructure/redis/RedisUserProcessingLock';
import { GetConversationState } from '../../src/application/use-cases/conversation/GetConversationState';
import { TransitionConversationState } from '../../src/application/use-cases/conversation/TransitionConversationState';
import { ValidateConversationSnapshot } from '../../src/application/services/semantic-router/ValidateConversationSnapshot';
import { ProjectSemanticRouterInput } from '../../src/application/services/semantic-router/ProjectSemanticRouterInput';
import {
  ObserveSemanticRouting,
  type SemanticRoutingObservation,
} from '../../src/application/services/semantic-router/ObserveSemanticRouting';
import {
  Sha256SemanticRoutingPolicy,
  type SemanticRoutingMode,
  type SemanticRoutingPolicy,
} from '../../src/application/services/semantic-router/runtime-policy';
import { CurrentDeterministicRoutingPolicy } from '../../src/application/services/semantic-router/deterministic-routing';
import { ClassifyFreeTextExpenseIntent } from '../../src/application/use-cases/conversation/ClassifyFreeTextExpenseIntent';
import { SendExpenseGuidance } from '../../src/application/use-cases/conversation/SendExpenseGuidance';
import { SendImmediateAcknowledgement } from '../../src/application/use-cases/conversation/SendImmediateAcknowledgement';
import { RouteIncomingMessage } from '../../src/application/use-cases/conversation/RouteIncomingMessage';
import { HandleUnsupportedMessage } from '../../src/application/use-cases/conversation/HandleUnsupportedMessage';
import { ResolveUserIdentityUseCase } from '../../src/application/use-cases/user/ResolveUserIdentity';
import { RegisterExpenseUseCase } from '../../src/application/use-cases/expense/RegisterExpense';
import { CompleteExpenseClarification } from '../../src/application/use-cases/expense/CompleteExpenseClarification';
import { CorrectExpenseUseCase } from '../../src/application/use-cases/expense/CorrectExpenseUseCase';
import { QueuePendingExpense } from '../../src/application/use-cases/expense/QueuePendingExpense';
import { DispatchExpenseSemanticAction } from '../../src/application/use-cases/expense/DispatchExpenseSemanticAction';
import { GenerateExpenseSummaryUseCase } from '../../src/application/use-cases/expense/GenerateExpenseSummaryUseCase';
import { AdvancePendingExpense } from '../../src/application/use-cases/expense/AdvancePendingExpense';
import { CancelExpenseRegistrationUseCase } from '../../src/application/use-cases/expense/CancelExpenseRegistrationUseCase';
import { ResolveExpenseSummaryActionUseCase } from '../../src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase';
import { ResolveExpenseReviewReplyUseCase } from '../../src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase';
import { processIncomingMessageJob } from '../../src/interfaces/workers/incomingMessage.worker';
import {
  processMessageJob,
  type MessageWorkerDeps,
} from '../../src/interfaces/workers/message.worker';
import {
  registerTelegramWebhook,
  type TelegramWebhookDeps,
} from '../../src/interfaces/http/routes/telegram.webhook';
import type { IncomingMessageJobData } from '../../src/application/ports/IncomingMessageJob';
import type { ProcessMessageJobData } from '../../src/application/ports/ProcessMessageJob';
import type { MessagingOutputPort } from '../../src/application/ports/output/messaging.port';
import type { ExpenseSummary } from '../../src/application/dtos/expense-summary.dto';
import type { ExpenseReviewBinding } from '../../src/domain/value-objects/expense-review-binding';
import type { LLMPort, SpreadsheetPortFactory } from '../../src/domain/ports/services';
import type { SemanticRouterPort } from '../../src/domain/ports/SemanticRouterPort';

const WEBHOOK_SECRET = 'expense-flow-secret';
const EXTERNAL_ID = '34600111222';
const MERCADONA_MESSAGE =
  'Fecha: 11 sept 2026, 21:09\nComercio: Mercadona\nImporte: 16,55\u00a0€\nTarjeta: CREDITO SANTANDER\nNombre: Mercadona\nTransacción: Mercadona';
const ROUTER_METADATA = {
  provider: 'openai',
  model: 'gpt-4o-mini-2024-07-18',
  promptVersion: 'semantic-openai-v1',
  contractVersion: 'semantic-contract-v1' as const,
  latencyMs: 11,
  inputTokens: 18,
  outputTokens: 4,
};

type Database = PostgresJsDatabase<typeof schema>;

interface ExpenseFlowHarness {
  readonly userId: string;
  readonly deps: MessageWorkerDeps;
  readonly stateRepo: DrizzleConversationStateRepository;
  readonly expenseRepo: DrizzleExpenseRecordRepository;
  readonly queueRepo: DrizzleExpenseQueueRepository;
  readonly routerDecide: ReturnType<typeof vi.fn>;
  readonly extractExpense: ReturnType<typeof vi.fn>;
  readonly interpretCorrection: ReturnType<typeof vi.fn>;
  readonly appendRow: ReturnType<typeof vi.fn>;
  readonly deleteRow: ReturnType<typeof vi.fn>;
  readonly messages: string[];
  readonly summaries: Array<{ summary: ExpenseSummary; binding: ExpenseReviewBinding }>;
  readonly observations: SemanticRoutingObservation[];
  readonly errors: ReturnType<typeof vi.fn>;
  readonly policy: SemanticRoutingPolicy;
  readonly setMode: (mode: SemanticRoutingMode) => void;
}

describe.skipIf(!isDockerAvailable())('Integration :: semantic router expense flows', () => {
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

  async function buildHarness(initialMode: SemanticRoutingMode = 'enabled') {
    const user = await createUser(db, { defaultCurrency: 'EUR' });
    await createMessagingIdentity(db, { userId: user.userId, externalId: EXTERNAL_ID });
    await createConversationState(db, { userId: user.userId });
    const spreadsheet = await createSpreadsheetConfig(db, { userId: user.userId });

    const stateRepo = new DrizzleConversationStateRepository(db);
    const userRepo = new DrizzleUserRepository(db, redis);
    const profileRepo = new DrizzleUserProfileRepository(userRepo);
    const spreadsheetConfigRepo = new DrizzleSpreadsheetConfigRepository(db);
    const columnMappingRepo = new DrizzleColumnMappingRepository(db);
    const expenseRepo = new DrizzleExpenseRecordRepository(db);
    const queueRepo = new DrizzleExpenseQueueRepository(db);
    const operationLogRepo = new DrizzleOperationLogRepository(db);
    await columnMappingRepo.upsertMany([
      mapping(spreadsheet.id, 'monto', 0),
      mapping(spreadsheet.id, 'moneda', 1),
      mapping(spreadsheet.id, 'fecha', 2),
      mapping(spreadsheet.id, 'concepto', 3),
      mapping(spreadsheet.id, 'medio_pago', 4),
    ]);

    const messages: string[] = [];
    const summaries: Array<{ summary: ExpenseSummary; binding: ExpenseReviewBinding }> = [];
    const observations: SemanticRoutingObservation[] = [];
    const errors = vi.fn();
    const messaging: MessagingOutputPort = {
      sendMessage: vi.fn(async (_externalId: string, text: string) => {
        messages.push(text);
        return { status: 'success' as const };
      }),
    };
    const appendRow = vi.fn().mockResolvedValue({ sheet: 'Gastos', row: 7 });
    const deleteRow = vi.fn().mockResolvedValue(undefined);
    const spreadsheetPortFactory = {
      create: vi.fn(() => ({ appendRow, deleteRow })),
    } as unknown as SpreadsheetPortFactory;
    const extractExpense = vi.fn(async (rawMessage: string) => extractedFor(rawMessage));
    const interpretCorrection = vi.fn(async (rawMessage: string) => ({
      intent: 'correction' as const,
      changedFields: rawMessage.includes('25') ? (['monto'] as const) : ([] as const),
      monto: rawMessage.includes('25') ? 25 : null,
      moneda: null,
      categoriaRaw: null,
      subcategoriaRaw: null,
      fechaRaw: null,
    }));
    const llm: LLMPort = {
      extractExpense,
      interpretCorrection,
      generateResponse: vi.fn(),
    };
    const transitionState = new TransitionConversationState(stateRepo);
    const registerExpense = new RegisterExpenseUseCase(
      llm,
      spreadsheetPortFactory,
      expenseRepo,
      spreadsheetConfigRepo,
      columnMappingRepo,
      { findActiveBySpreadsheetId: vi.fn().mockResolvedValue([]) } as never,
      { findBySpreadsheetId: vi.fn().mockResolvedValue(null) } as never,
      transitionState,
      operationLogRepo,
      profileRepo,
      {
        execute: vi.fn(async (input) => ({
          category: {
            id: null,
            name: input.llmCategory,
            status: input.llmCategory ? ('confirmed' as const) : ('none' as const),
            confidence: input.llmConfidence,
          },
          subcategory: {
            id: null,
            name: null,
            categoryId: null,
            status: 'none' as const,
            confidence: 'nula' as const,
          },
        })),
      },
      {
        getValidAccessToken: vi.fn().mockResolvedValue({
          accessToken: 'integration-token',
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          refreshed: false,
        }),
        forceRefreshAccessToken: vi.fn(),
      },
    );
    const completeClarification = new CompleteExpenseClarification(registerExpense);
    const correctExpense = new CorrectExpenseUseCase({
      llm,
      classifier: {
        execute: vi.fn(async () => ({
          category: { id: null, name: null, status: 'none', confidence: 'nula' },
          subcategory: {
            id: null,
            name: null,
            categoryId: null,
            status: 'none',
            confidence: 'nula',
          },
        })),
      },
      expenseRepo,
      spreadsheetConfigRepo,
      categoryVocabularyRepo: { findBySpreadsheetId: vi.fn().mockResolvedValue(null) } as never,
      transitionState,
    });
    const queuePendingExpense = new QueuePendingExpense(queueRepo);
    const snapshotValidator = new ValidateConversationSnapshot(
      stateRepo,
      (userId) => transitionState.currentState(userId) !== null,
    );
    const modes: Record<string, SemanticRoutingMode> = {
      IDLE: initialMode,
      EXPENSE_RECEIVING: initialMode,
      EXPENSE_CLARIFYING: initialMode,
      EXPENSE_REVIEW: initialMode,
    };
    const policy = new Sha256SemanticRoutingPolicy({
      stateModes: modes,
      cohortPercent: 100,
      shadowSamplePercent: 100,
      cohortSeed: 'expense-flow-integration',
    });
    const routerDecide = vi.fn(async (input) => ({
      status: 'proposed' as const,
      decision: semanticDecision(input.state, input.rawMessage),
      metadata: ROUTER_METADATA,
    }));
    const observeSemanticRouting = new ObserveSemanticRouting({
      policy,
      projector: new ProjectSemanticRouterInput(),
      router: { decide: routerDecide } satisfies SemanticRouterPort,
      snapshotValidator,
      telemetry: { record: (observation) => observations.push(observation) },
    });
    const dispatchExpenseSemanticAction = new DispatchExpenseSemanticAction({
      snapshotValidator,
      transitionState,
      registerExpense,
      completeClarification,
      correctExpense,
      queuePendingExpense,
    });
    const generateExpenseSummary = new GenerateExpenseSummaryUseCase(expenseRepo, transitionState);
    const presenterFactory = (output: MessagingOutputPort, chatId: string) => ({
      presentSummary: async (summary: ExpenseSummary, binding: ExpenseReviewBinding) => {
        summaries.push({ summary, binding });
        await output.sendMessage(chatId, `REVIEW ${summary.amount} ${summary.currency}`);
      },
      showTimeoutWarning: async () => undefined,
      notifyCancellation: async () => undefined,
      requestHighAmountConfirmation: async () => undefined,
    });
    const advancePendingExpense = new AdvancePendingExpense({
      expenseQueueRepository: queueRepo,
      registerExpense,
      generateExpenseSummary,
      messagingPort: messaging,
      expenseSummaryPresenterFactory: presenterFactory,
    });
    const cancelExpenseRegistration = new CancelExpenseRegistrationUseCase({
      transitionState,
      messagingPort: messaging,
      advancePendingExpense,
    });
    const resolveExpenseSummaryAction = new ResolveExpenseSummaryActionUseCase({
      registerExpense,
      transitionState,
      messagingPort: messaging,
      cancelExpenseRegistration,
      operationLogRepo,
      advancePendingExpense,
    });
    const resolveExpenseReviewReply = new ResolveExpenseReviewReplyUseCase({
      resolveExpenseSummaryAction,
      correctExpense,
      queuePendingExpense,
      expenseQueueRepository: queueRepo,
    });
    const classifier = new ClassifyFreeTextExpenseIntent();
    const deps = {
      redis,
      logger: { error: errors },
      userProcessingLock: new RedisUserProcessingLock(redis),
      registerExpense,
      queuePendingExpense,
      classifyFreeTextExpenseIntent: classifier,
      deterministicRoutingPolicy: new CurrentDeterministicRoutingPolicy(classifier),
      observeSemanticRouting,
      dispatchExpenseSemanticAction,
      completeExpenseClarification: completeClarification,
      sendGuidance: new SendExpenseGuidance(messaging),
      correctExpense,
      generateExpenseSummary,
      resolveExpenseSummaryAction,
      cancelExpenseRegistration,
      resolveExpenseReviewReply,
      getConversationState: new GetConversationState(stateRepo),
      transitionState,
      recoverCorruptedState: { execute: vi.fn() },
      userRepo,
      messagingAdapters: { telegram: messaging, whatsapp: messaging },
      expenseSummaryPresenterFactory: presenterFactory,
    } as unknown as MessageWorkerDeps;

    return {
      userId: user.userId,
      deps,
      stateRepo,
      expenseRepo,
      queueRepo,
      routerDecide,
      extractExpense,
      interpretCorrection,
      appendRow,
      deleteRow,
      messages,
      summaries,
      observations,
      errors,
      policy,
      setMode: (mode: SemanticRoutingMode) => {
        for (const stateName of Object.keys(modes)) modes[stateName] = mode;
      },
    } satisfies ExpenseFlowHarness;
  }

  it('runs the canonical webhook conversation and saves the exact expense only after bound confirmation', async () => {
    const harness = await buildHarness();
    const processJobs = await deliverWebhook(harness, MERCADONA_MESSAGE, 91001);

    expect(processJobs).toHaveLength(1);
    await processMessageJob({ data: processJobs[0] } as Job<ProcessMessageJobData>, harness.deps);

    const reviewState = await harness.stateRepo.findByUserId(harness.userId);
    expect({
      reviewState,
      errors: harness.errors.mock.calls,
      observations: harness.observations,
      messages: harness.messages,
      routerCalls: harness.routerDecide.mock.calls,
      extractCalls: harness.extractExpense.mock.calls,
    }).toMatchObject({
      reviewState: { currentState: 'EXPENSE_REVIEW' },
      errors: [],
    });
    expect(reviewState?.statePayload).toMatchObject({
      rawMessage: MERCADONA_MESSAGE,
      resolvedDate: '2026-09-11',
      extracted: {
        monto: 16.55,
        moneda: 'EUR',
        categoriaRaw: 'Mercadona',
        medioPago: 'CREDITO SANTANDER',
      },
      reviewBinding: { presentedAt: expect.any(String) },
    });
    expect(harness.appendRow).not.toHaveBeenCalled();
    expect(await harness.expenseRepo.findLatestByUserId(harness.userId)).toBeNull();

    await processMessageJob(job(harness, 'sí', 'confirm-1', futureTimestamp()), harness.deps);

    const saved = await harness.expenseRepo.findLatestByUserId(harness.userId);
    expect(saved).toMatchObject({
      monto: 16.55,
      moneda: 'EUR',
      concepto: 'Mercadona',
      medioPago: 'CREDITO SANTANDER',
      rawMessage: MERCADONA_MESSAGE,
    });
    expect(saved?.fechaGasto.toISOString().slice(0, 10)).toBe('2026-09-11');
    expect(harness.appendRow).toHaveBeenCalledOnce();
    expect(harness.deleteRow).not.toHaveBeenCalled();
    expect(harness.routerDecide).toHaveBeenCalledOnce();
    expect(harness.extractExpense).toHaveBeenCalledOnce();
    expect(harness.observations).toEqual([
      expect.objectContaining({
        mode: 'enabled',
        state: 'IDLE',
        proposedAction: 'register_expense',
        policyOutcome: 'allowed_enabled',
        provider: 'openai',
        model: 'gpt-4o-mini-2024-07-18',
        promptVersion: 'semantic-openai-v1',
        contractVersion: 'semantic-contract-v1',
        policyVersion: 'semantic-policy-v1',
        latencyMs: 11,
      }),
      expect.objectContaining({ state: 'EXPENSE_REVIEW', policyOutcome: 'deterministic_bypass' }),
    ]);
    expect(JSON.stringify(harness.observations)).not.toMatch(
      /Mercadona|34600111222|operationId|reviewBinding|providerBody|reasoning|integration-token/,
    );
  });

  it('completes clarification, queues another expense, cancels, and advances FIFO without losing source text', async () => {
    const harness = await buildHarness();

    await deliverWebhookAndProcess(harness, 'Taxi en euros', 92001);
    expect({
      state: await harness.stateRepo.findByUserId(harness.userId),
      errors: harness.errors.mock.calls,
    }).toMatchObject({
      state: {
        currentState: 'EXPENSE_CLARIFYING',
        statePayload: { rawMessage: 'Taxi en euros', missingField: 'monto' },
      },
      errors: [],
    });

    await deliverWebhookAndProcess(harness, '25', 92002);
    expect(await harness.stateRepo.findByUserId(harness.userId)).toMatchObject({
      currentState: 'EXPENSE_REVIEW',
      statePayload: { rawMessage: 'Taxi en euros 25', extracted: { monto: 25, moneda: 'EUR' } },
    });

    await deliverWebhookAndProcess(harness, 'Farmacia 8 EUR', 92003);
    expect(await harness.queueRepo.findByUserId(harness.userId)).toEqual([
      expect.objectContaining({ position: 1, rawMessage: 'Farmacia 8 EUR' }),
    ]);
    expect((await harness.stateRepo.findByUserId(harness.userId))?.currentState).toBe(
      'EXPENSE_REVIEW',
    );

    await processMessageJob(job(harness, 'cancelar', 'cancel-1', futureTimestamp()), harness.deps);

    expect(await harness.queueRepo.findByUserId(harness.userId)).toEqual([]);
    expect(await harness.stateRepo.findByUserId(harness.userId)).toMatchObject({
      currentState: 'EXPENSE_REVIEW',
      statePayload: {
        rawMessage: 'Farmacia 8 EUR',
        extracted: { monto: 8, moneda: 'EUR' },
        queueRegisteredCount: 0,
      },
    });
    expect(harness.extractExpense).toHaveBeenCalledTimes(3);
    expect(harness.appendRow).not.toHaveBeenCalled();
    expect(harness.deleteRow).not.toHaveBeenCalled();
  });

  it('invalidates the old binding after semantic correction and saves the corrected amount once', async () => {
    const harness = await buildHarness();
    await deliverWebhookAndProcess(harness, MERCADONA_MESSAGE, 93001);
    const first = (await harness.stateRepo.findByUserId(harness.userId))!;
    const oldBinding = first.statePayload?.reviewBinding as ExpenseReviewBinding;

    await deliverWebhookAndProcess(harness, 'sí, pero cambia el importe a 25', 93002);
    const corrected = (await harness.stateRepo.findByUserId(harness.userId))!;
    const newBinding = corrected.statePayload?.reviewBinding as ExpenseReviewBinding;
    expect(corrected.statePayload).toMatchObject({ extracted: { monto: 25 } });
    expect(newBinding.revision).toBe(oldBinding.revision + 1);
    expect(newBinding.presentedAt).toEqual(expect.any(String));
    expect(harness.appendRow).not.toHaveBeenCalled();

    await processMessageJob(
      callbackJob(harness, oldBinding, 'old-confirm', futureTimestamp()),
      harness.deps,
    );
    expect(harness.appendRow).not.toHaveBeenCalled();

    const rebound = (await harness.stateRepo.findByUserId(harness.userId))!.statePayload
      ?.reviewBinding as ExpenseReviewBinding;
    await processMessageJob(
      callbackJob(harness, rebound, 'new-confirm', futureTimestamp()),
      harness.deps,
    );

    expect(harness.appendRow).toHaveBeenCalledOnce();
    expect(await harness.expenseRepo.findLatestByUserId(harness.userId)).toMatchObject({
      monto: 25,
      rawMessage: MERCADONA_MESSAGE,
    });
    expect(harness.interpretCorrection).toHaveBeenCalledOnce();
    expect(harness.routerDecide).toHaveBeenCalledTimes(2);
  });

  it('handles clarification replacement and review queue overflow through webhook-to-worker delivery', async () => {
    const harness = await buildHarness();

    await deliverWebhookAndProcess(harness, 'Taxi en euros', 94001);
    await deliverWebhookAndProcess(harness, MERCADONA_MESSAGE, 94002);

    expect(await harness.stateRepo.findByUserId(harness.userId)).toMatchObject({
      currentState: 'EXPENSE_REVIEW',
      statePayload: {
        rawMessage: MERCADONA_MESSAGE,
        resolvedDate: '2026-09-11',
        extracted: { monto: 16.55, moneda: 'EUR' },
      },
    });

    await deliverWebhookAndProcess(harness, 'Farmacia 8 EUR', 94003);
    await deliverWebhookAndProcess(harness, 'Taxi 7 EUR', 94004);
    await deliverWebhookAndProcess(harness, 'Supermercado 9 EUR', 94005);

    expect(await harness.queueRepo.findByUserId(harness.userId)).toEqual([
      expect.objectContaining({ position: 1, rawMessage: 'Farmacia 8 EUR' }),
      expect.objectContaining({ position: 2, rawMessage: 'Taxi 7 EUR' }),
    ]);
    expect(await harness.stateRepo.findByUserId(harness.userId)).toMatchObject({
      currentState: 'EXPENSE_REVIEW',
      statePayload: { rawMessage: MERCADONA_MESSAGE },
    });
    expect(harness.extractExpense).toHaveBeenCalledTimes(2);
    expect(harness.appendRow).not.toHaveBeenCalled();
    expect(harness.deleteRow).not.toHaveBeenCalled();
    expect(
      harness.messages.some((message) =>
        message.includes('Confirmá o cancelá el actual antes de agregar otro'),
      ),
    ).toBe(true);
  });

  it.each([
    ['provider timeout', { status: 'failed', code: 'TIMEOUT' }],
    ['provider refusal', { status: 'failed', code: 'MODEL_REFUSAL' }],
    ['invalid provider output', { unexpected: true }],
  ] as const)(
    'fails closed on %s without expense, queue, or spreadsheet effects',
    async (_name, result) => {
      const harness = await buildHarness();
      harness.routerDecide.mockResolvedValueOnce(result as never);

      await deliverWebhookAndProcess(harness, 'Mercadona 16,55 EUR', 95001);

      expect(await harness.stateRepo.findByUserId(harness.userId)).toMatchObject({
        currentState: 'IDLE',
        statePayload: null,
      });
      expect(await harness.expenseRepo.findLatestByUserId(harness.userId)).toBeNull();
      expect(await harness.queueRepo.findByUserId(harness.userId)).toEqual([]);
      expect(harness.extractExpense).not.toHaveBeenCalled();
      expect(harness.interpretCorrection).not.toHaveBeenCalled();
      expect(harness.appendRow).not.toHaveBeenCalled();
      expect(harness.deleteRow).not.toHaveBeenCalled();
      expect(harness.messages).toHaveLength(2);
      expect(harness.observations).toEqual([
        expect.objectContaining({ mode: 'enabled', policyOutcome: 'router_failure' }),
      ]);
    },
  );

  it('rejects an invalid legacy review payload before router or financial effects', async () => {
    const harness = await buildHarness();
    await sql`
      update conversation_states
      set current_state = 'EXPENSE_REVIEW',
          state_payload = ${sql.json({ legacy: true })},
          revision = revision + 1
      where user_id = ${harness.userId}
    `;

    await deliverWebhookAndProcess(harness, 'Cambia el importe a 25', 96001);

    expect(harness.routerDecide).not.toHaveBeenCalled();
    expect(harness.extractExpense).not.toHaveBeenCalled();
    expect(harness.interpretCorrection).not.toHaveBeenCalled();
    expect(await harness.expenseRepo.findLatestByUserId(harness.userId)).toBeNull();
    expect(await harness.queueRepo.findByUserId(harness.userId)).toEqual([]);
    expect(harness.appendRow).not.toHaveBeenCalled();
    expect(harness.deleteRow).not.toHaveBeenCalled();
    expect(harness.observations).toEqual([
      expect.objectContaining({
        mode: 'enabled',
        policyOutcome: 'invalid_context',
        errorCode: 'INVALID_STATE_CONTEXT',
      }),
    ]);
  });

  it('rolls queued work back from enabled to shadow and off with active payloads intact', async () => {
    const harness = await buildHarness('enabled');
    await processMessageJob(job(harness, 'Taxi en euros', 'clarification-start'), harness.deps);
    const clarification = (await harness.stateRepo.findByUserId(harness.userId))!;
    const queuedClarificationReply = job(harness, '25', 'queued-before-shadow');
    harness.setMode('shadow');

    await processMessageJob(queuedClarificationReply, harness.deps);

    expect(await harness.stateRepo.findByUserId(harness.userId)).toMatchObject({
      currentState: 'EXPENSE_REVIEW',
      statePayload: { rawMessage: 'Taxi en euros 25' },
    });
    expect(clarification.statePayload).toMatchObject({ rawMessage: 'Taxi en euros' });
    expect(harness.routerDecide).toHaveBeenCalledTimes(2);

    const queuedReviewCancellation = job(
      harness,
      'cancelar',
      'queued-before-off',
      futureTimestamp(),
    );
    harness.setMode('off');
    await processMessageJob(queuedReviewCancellation, harness.deps);

    expect(await harness.stateRepo.findByUserId(harness.userId)).toMatchObject({
      currentState: 'IDLE',
      statePayload: null,
    });
    expect(await harness.queueRepo.findByUserId(harness.userId)).toEqual([]);
    expect(harness.appendRow).not.toHaveBeenCalled();
    expect(harness.deleteRow).not.toHaveBeenCalled();
    expect(harness.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: 'shadow', policyOutcome: 'allowed_shadow' }),
        expect.objectContaining({ mode: 'off', policyOutcome: 'disabled' }),
      ]),
    );
  });

  async function deliverWebhook(
    harness: ExpenseFlowHarness,
    text: string,
    updateId: number,
  ): Promise<ProcessMessageJobData[]> {
    const incomingJobs: IncomingMessageJobData[] = [];
    const processJobs: ProcessMessageJobData[] = [];
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerTelegramWebhook(app, {
      webhookSecret: WEBHOOK_SECRET,
      incomingMessageQueue: {
        add: vi.fn((_name: string, data: IncomingMessageJobData) => {
          incomingJobs.push(data);
          return Promise.resolve();
        }),
      } as unknown as Queue<IncomingMessageJobData>,
      handleStartCommand: { execute: vi.fn() } as never,
      sendImmediateAcknowledgement: new SendImmediateAcknowledgement(
        harness.deps.messagingAdapters.telegram,
      ),
      resolveIdentity: new ResolveUserIdentityUseCase(harness.deps.userRepo, harness.stateRepo),
    } satisfies TelegramWebhookDeps);
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      payload: {
        update_id: updateId,
        message: {
          message_id: updateId,
          from: { id: Number(EXTERNAL_ID) },
          chat: { id: Number(EXTERNAL_ID), type: 'private' },
          text,
          date: Math.floor(Date.now() / 1000),
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(incomingJobs).toHaveLength(1);

    const route = new RouteIncomingMessage({
      messageQueue: {
        add: vi.fn((_name: string, data: ProcessMessageJobData) => {
          processJobs.push(data);
          return Promise.resolve();
        }),
      } as unknown as Queue<ProcessMessageJobData>,
      resolveIdentity: new ResolveUserIdentityUseCase(harness.deps.userRepo, harness.stateRepo),
      handleUnsupportedMessage: new HandleUnsupportedMessage(
        harness.deps.messagingAdapters.telegram,
      ),
      deterministicRoutingPolicy: harness.deps.deterministicRoutingPolicy,
      sendGuidance: harness.deps.sendGuidance,
      getConversationState: harness.deps.getConversationState,
      processedMessageRepository: new RedisProcessedMessageRepository(redis),
      semanticRoutingPolicy: harness.policy,
    });
    await processIncomingMessageJob(
      { data: incomingJobs[0] } as Job<IncomingMessageJobData>,
      route,
    );
    await processIncomingMessageJob(
      { data: incomingJobs[0] } as Job<IncomingMessageJobData>,
      route,
    );
    expect(processJobs).toHaveLength(1);
    await app.close();
    return processJobs;
  }

  async function deliverWebhookAndProcess(
    harness: ExpenseFlowHarness,
    text: string,
    updateId: number,
  ): Promise<void> {
    const processJobs = await deliverWebhook(harness, text, updateId);
    await processMessageJob({ data: processJobs[0] } as Job<ProcessMessageJobData>, harness.deps);
  }
});

function mapping(
  spreadsheetId: string,
  GasttoField: 'monto' | 'moneda' | 'fecha' | 'concepto' | 'medio_pago',
  columnIndex: number,
) {
  return {
    spreadsheetId,
    GasttoField,
    columnIndex,
    columnHeader: GasttoField,
    inferred: false,
    confirmedAt: new Date(),
  };
}

function extractedFor(rawMessage: string) {
  if (rawMessage.includes('Mercadona')) {
    return {
      monto: 16.55,
      moneda: 'EUR' as const,
      categoriaRaw: 'Mercadona',
      subcategoriaRaw: null,
      fechaRaw: '2026-09-11',
      medioPago: 'CREDITO SANTANDER',
      confianzaCategoria: 'alta' as const,
      confianzaSubcategoria: 'nula' as const,
    };
  }
  if (rawMessage.includes('Farmacia')) {
    return {
      monto: 8,
      moneda: 'EUR' as const,
      categoriaRaw: 'Farmacia',
      subcategoriaRaw: null,
      fechaRaw: '2026-09-16',
      medioPago: null,
      confianzaCategoria: 'alta' as const,
      confianzaSubcategoria: 'nula' as const,
    };
  }
  return {
    monto: rawMessage.includes('25') ? 25 : null,
    moneda: 'EUR' as const,
    categoriaRaw: 'Taxi',
    subcategoriaRaw: null,
    fechaRaw: '2026-09-16',
    medioPago: null,
    confianzaCategoria: 'alta' as const,
    confianzaSubcategoria: 'nula' as const,
  };
}

function semanticDecision(state: string, rawMessage: string) {
  if (state === 'EXPENSE_CLARIFYING' && rawMessage === '25') {
    return { action: 'provide_missing_expense_data' as const };
  }
  if (state === 'EXPENSE_REVIEW' && rawMessage.includes('cambia el importe')) {
    return { action: 'correct_expense' as const };
  }
  return { action: 'register_expense' as const };
}

function job(
  harness: ExpenseFlowHarness,
  rawMessage: string,
  externalMessageId: string,
  receivedAt = new Date().toISOString(),
): Job<ProcessMessageJobData> {
  return {
    data: {
      userId: harness.userId,
      rawMessage,
      channel: 'telegram',
      externalId: EXTERNAL_ID,
      externalMessageId,
      receivedAt,
    },
  } as Job<ProcessMessageJobData>;
}

function callbackJob(
  harness: ExpenseFlowHarness,
  binding: ExpenseReviewBinding,
  externalMessageId: string,
  receivedAt: string,
): Job<ProcessMessageJobData> {
  return {
    data: {
      ...job(harness, '', externalMessageId, receivedAt).data,
      callbackData: {
        version: 1,
        action: 'confirm',
        operationId: binding.operationId,
        reviewRevision: binding.revision,
      },
    },
  } as Job<ProcessMessageJobData>;
}

function futureTimestamp(): string {
  return new Date(Date.now() + 1_000).toISOString();
}
