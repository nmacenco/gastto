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
import { createConversationState, createMessagingIdentity, createUser } from './helpers/fixtures';
import { DrizzleConversationStateRepository } from '../../src/infrastructure/db/repositories/DrizzleConversationStateRepository';
import { DrizzleUserRepository } from '../../src/infrastructure/db/repositories/DrizzleUserRepository';
import { RedisProcessedMessageRepository } from '../../src/infrastructure/redis/RedisProcessedMessageRepository';
import { RedisUserProcessingLock } from '../../src/infrastructure/redis/RedisUserProcessingLock';
import { GetConversationState } from '../../src/application/use-cases/conversation/GetConversationState';
import { TransitionConversationState } from '../../src/application/use-cases/conversation/TransitionConversationState';
import { ValidateConversationSnapshot } from '../../src/application/services/semantic-router/ValidateConversationSnapshot';
import { ProjectSemanticRouterInput } from '../../src/application/services/semantic-router/ProjectSemanticRouterInput';
import {
  ObserveSemanticRouting,
  type SemanticRoutingObservation,
  type SemanticRoutingTelemetryPort,
} from '../../src/application/services/semantic-router/ObserveSemanticRouting';
import {
  Sha256SemanticRoutingPolicy,
  type SemanticRoutingConfig,
} from '../../src/application/services/semantic-router/runtime-policy';
import { CurrentDeterministicRoutingPolicy } from '../../src/application/services/semantic-router/deterministic-routing';
import { ClassifyFreeTextExpenseIntent } from '../../src/application/use-cases/conversation/ClassifyFreeTextExpenseIntent';
import { SendExpenseGuidance } from '../../src/application/use-cases/conversation/SendExpenseGuidance';
import { SendImmediateAcknowledgement } from '../../src/application/use-cases/conversation/SendImmediateAcknowledgement';
import { RouteIncomingMessage } from '../../src/application/use-cases/conversation/RouteIncomingMessage';
import { HandleUnsupportedMessage } from '../../src/application/use-cases/conversation/HandleUnsupportedMessage';
import { ResolveUserIdentityUseCase } from '../../src/application/use-cases/user/ResolveUserIdentity';
import { DispatchExpenseSemanticAction } from '../../src/application/use-cases/expense/DispatchExpenseSemanticAction';
import { CompleteExpenseClarification } from '../../src/application/use-cases/expense/CompleteExpenseClarification';
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
import type { SemanticRouterPort } from '../../src/domain/ports/SemanticRouterPort';
import type { FsmState } from '../../src/domain/entities/ConversationState';
import { UserAlreadyProcessingError } from '../../src/domain/errors/UserAlreadyProcessingError';
import { PinoSemanticRoutingTelemetry } from '../../src/infrastructure/observability/PinoSemanticRoutingTelemetry';

const WEBHOOK_SECRET = 'shadow-pipeline-secret';
const ROUTER_METADATA = {
  provider: 'openai',
  model: 'gpt-4o-mini-2024-07-18',
  promptVersion: 'semantic-openai-v1',
  contractVersion: 'semantic-contract-v1' as const,
  latencyMs: 17,
  inputTokens: 12,
  outputTokens: 4,
};

type Database = PostgresJsDatabase<typeof schema>;

interface HarnessOptions {
  readonly mode?: 'off' | 'shadow' | 'enabled';
  readonly state?: FsmState;
  readonly statePayload?: Record<string, unknown> | null;
  readonly router?: SemanticRouterPort | null;
  readonly telemetry?: SemanticRoutingTelemetryPort;
  readonly executionCurrent?: () => boolean;
  readonly externalId?: string;
}

interface Harness {
  readonly userId: string;
  readonly externalId: string;
  readonly sendMessage: ReturnType<typeof vi.fn>;
  readonly routerDecide: ReturnType<typeof vi.fn>;
  readonly observations: SemanticRoutingObservation[];
  readonly errors: ReturnType<typeof vi.fn>;
  readonly stateRepo: DrizzleConversationStateRepository;
  readonly transitionState: TransitionConversationState;
  readonly policy: Sha256SemanticRoutingPolicy;
  readonly deps: MessageWorkerDeps;
}

describe.skipIf(!isDockerAvailable())('Integration :: semantic router shadow pipeline', () => {
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
    sql = postgres(getConnectionString(postgresContainer), { max: 6 });
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

  async function buildHarness(options: HarnessOptions = {}): Promise<Harness> {
    const externalId = options.externalId ?? '123456789';
    const user = await createUser(db);
    await createMessagingIdentity(db, { userId: user.userId, externalId });
    await createConversationState(db, {
      userId: user.userId,
      currentState: options.state ?? 'IDLE',
      statePayload: options.statePayload ?? null,
    });

    const stateRepo = new DrizzleConversationStateRepository(db);
    const userRepo = new DrizzleUserRepository(db, redis);
    const transitionState = new TransitionConversationState(stateRepo);
    const getConversationState = new GetConversationState(stateRepo);
    const sendMessage = vi.fn().mockResolvedValue({ status: 'success' });
    const messaging: MessagingOutputPort = { sendMessage };
    const classifier = new ClassifyFreeTextExpenseIntent();
    const deterministicRoutingPolicy = new CurrentDeterministicRoutingPolicy(classifier);
    const config: SemanticRoutingConfig = {
      stateModes: { [options.state ?? 'IDLE']: options.mode ?? 'shadow' },
      cohortPercent: 100,
      shadowSamplePercent: 100,
      cohortSeed: 'integration-seed',
    };
    const policy = new Sha256SemanticRoutingPolicy(config);
    const routerDecide = vi.fn().mockResolvedValue({
      status: 'proposed',
      decision: { action: 'register_expense' },
      metadata: ROUTER_METADATA,
    });
    const router =
      options.router === undefined
        ? ({ decide: routerDecide } satisfies SemanticRouterPort)
        : options.router;
    const observations: SemanticRoutingObservation[] = [];
    const telemetry =
      options.telemetry ??
      ({
        record: (observation: SemanticRoutingObservation) => observations.push(observation),
      } satisfies SemanticRoutingTelemetryPort);
    const snapshotValidator = new ValidateConversationSnapshot(
      stateRepo,
      options.executionCurrent ?? (() => transitionState.currentState(user.userId) !== null),
    );
    const observeSemanticRouting = new ObserveSemanticRouting({
      policy,
      projector: new ProjectSemanticRouterInput(),
      router,
      snapshotValidator,
      telemetry,
    });
    const registerExpenseInterpret = vi
      .fn()
      .mockResolvedValue({ status: 'needs_clarification', missingField: 'monto' });
    const dispatchExpenseSemanticAction = new DispatchExpenseSemanticAction({
      snapshotValidator,
      registerExpense: { interpret: registerExpenseInterpret },
      completeClarification: new CompleteExpenseClarification({
        interpret: registerExpenseInterpret,
      }),
      correctExpense: { execute: vi.fn() },
      queuePendingExpense: { execute: vi.fn() },
    });
    const errors = vi.fn();
    const deps = {
      redis,
      logger: { error: errors },
      userProcessingLock: new RedisUserProcessingLock(redis),
      registerExpense: {
        interpret: registerExpenseInterpret,
      },
      queuePendingExpense: { execute: vi.fn() },
      classifyFreeTextExpenseIntent: classifier,
      deterministicRoutingPolicy,
      observeSemanticRouting,
      dispatchExpenseSemanticAction,
      completeExpenseClarification: new CompleteExpenseClarification({
        interpret: registerExpenseInterpret,
      }),
      sendGuidance: new SendExpenseGuidance(messaging),
      getConversationState,
      transitionState,
      recoverCorruptedState: { execute: vi.fn() },
      userRepo,
      messagingAdapters: { telegram: messaging, whatsapp: messaging },
      cancelExpenseRegistration: { execute: vi.fn() },
    } as unknown as MessageWorkerDeps;

    return {
      userId: user.userId,
      externalId,
      sendMessage,
      routerDecide,
      registerExpenseInterpret,
      observations,
      errors,
      stateRepo,
      transitionState,
      policy,
      deps,
    };
  }

  function job(
    harness: Harness,
    rawMessage = 'El banco avisa de un movimiento reciente en Mercadona',
    externalMessageId = 'message-1',
  ): Job<ProcessMessageJobData> {
    return {
      data: {
        userId: harness.userId,
        rawMessage,
        channel: 'telegram',
        externalId: harness.externalId,
        externalMessageId,
        receivedAt: new Date().toISOString(),
      },
    } as Job<ProcessMessageJobData>;
  }

  it('observes a previously filtered notification but preserves deterministic guidance', async () => {
    const harness = await buildHarness();

    await processMessageJob(job(harness), harness.deps);

    expect(harness.routerDecide).toHaveBeenCalledOnce();
    expect(harness.observations).toEqual([
      expect.objectContaining({
        event: 'semantic_router_observation',
        mode: 'shadow',
        state: 'IDLE',
        substep: null,
        deterministicDecision: 'expense_guidance',
        proposedAction: 'register_expense',
        policyOutcome: 'allowed_shadow',
        provider: 'openai',
        model: 'gpt-4o-mini-2024-07-18',
        promptVersion: 'semantic-openai-v1',
        contractVersion: 'semantic-contract-v1',
        policyVersion: 'semantic-policy-v1',
        latencyMs: 17,
        errorCode: null,
      }),
    ]);
    expect(harness.sendMessage).toHaveBeenCalledOnce();
    await expect(harness.stateRepo.findByUserId(harness.userId)).resolves.toMatchObject({
      currentState: 'IDLE',
      revision: '0',
    });
  });

  it('runs a deterministic expense exactly once regardless of the shadow proposal', async () => {
    const harness = await buildHarness();
    const interpret = harness.deps.registerExpense!.interpret as ReturnType<typeof vi.fn>;

    await processMessageJob(job(harness, 'Café 12 EUR'), harness.deps);

    expect(interpret).toHaveBeenCalledOnce();
    expect(harness.routerDecide).toHaveBeenCalledOnce();
    expect(harness.sendMessage).toHaveBeenCalledOnce();
    expect(harness.observations).toHaveLength(1);
  });

  it('deduplicates delivery before process-message admission using real Redis', async () => {
    const harness = await buildHarness();
    const processJobs: ProcessMessageJobData[] = [];
    const route = new RouteIncomingMessage({
      messageQueue: {
        add: vi.fn((_name: string, data: ProcessMessageJobData) => {
          processJobs.push(data);
          return Promise.resolve();
        }),
      } as unknown as Queue<ProcessMessageJobData>,
      resolveIdentity: new ResolveUserIdentityUseCase(harness.deps.userRepo, harness.stateRepo),
      handleUnsupportedMessage: new HandleUnsupportedMessage({ sendMessage: harness.sendMessage }),
      deterministicRoutingPolicy: harness.deps.deterministicRoutingPolicy,
      sendGuidance: harness.deps.sendGuidance,
      getConversationState: harness.deps.getConversationState,
      processedMessageRepository: new RedisProcessedMessageRepository(redis),
      semanticRoutingPolicy: harness.policy,
    });
    const payload = {
      messageType: 'TEXT' as const,
      chatId: harness.externalId,
      userId: harness.externalId,
      text: 'Aviso de compra confirmado por el banco',
      timestamp: new Date(),
      channel: 'telegram' as const,
      externalMessageId: 'duplicate-1',
      rawPayload: {},
    };

    await route.execute(payload);
    await route.execute(payload);

    expect(processJobs).toHaveLength(1);
  });

  it('serializes two messages for one user and retries cleanly after lock contention', async () => {
    let releaseRouter!: () => void;
    const pending = new Promise<void>((resolve) => {
      releaseRouter = resolve;
    });
    const harness = await buildHarness({
      router: {
        decide: vi.fn(async () => {
          await pending;
          return {
            status: 'proposed',
            decision: { action: 'register_expense' },
            metadata: ROUTER_METADATA,
          };
        }),
      },
    });
    const first = processMessageJob(job(harness, 'hola', 'message-a'), harness.deps);
    await vi.waitFor(async () =>
      expect(await redis.exists(`process-message:lock:${harness.userId}`)).toBe(1),
    );

    await expect(
      processMessageJob(job(harness, 'hola', 'message-b'), harness.deps),
    ).rejects.toBeInstanceOf(UserAlreadyProcessingError);
    releaseRouter();
    await first;
    await processMessageJob(job(harness, 'hola', 'message-b'), harness.deps);

    expect(harness.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('rejects identity mismatch before lock, model, or messaging effects', async () => {
    const harness = await buildHarness();

    await expect(
      processMessageJob(
        {
          data: { ...job(harness).data, userId: '00000000-0000-0000-0000-000000000000' },
        } as Job<ProcessMessageJobData>,
        harness.deps,
      ),
    ).rejects.toThrow('Messaging identity does not match job user');
    expect(harness.routerDecide).not.toHaveBeenCalled();
    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(await redis.keys('process-message:lock:*')).toEqual([]);
  });

  it('discards a proposal when the persisted revision changes while the model is pending', async () => {
    let releaseRouter!: () => void;
    const pending = new Promise<void>((resolve) => {
      releaseRouter = resolve;
    });
    const decide = vi.fn(async () => {
      await pending;
      return {
        status: 'proposed' as const,
        decision: { action: 'register_expense' as const },
        metadata: ROUTER_METADATA,
      };
    });
    const harness = await buildHarness({ router: { decide } });
    const running = processMessageJob(job(harness), harness.deps);
    await vi.waitFor(() => expect(decide).toHaveBeenCalledOnce());
    const observed = (await harness.stateRepo.findByUserId(harness.userId))!;
    await harness.stateRepo.transition({
      userId: harness.userId,
      expected: { revision: observed.revision, currentState: 'IDLE', expiry: 'any' },
      nextState: 'EXPENSE_RECEIVING',
      payload: null,
      expiresAt: null,
    });
    releaseRouter();
    await running;

    expect(harness.observations).toEqual([
      expect.objectContaining({ policyOutcome: 'stale_context', errorCode: 'STALE_CONTEXT' }),
    ]);
    expect(harness.sendMessage).toHaveBeenCalledOnce();
  });

  it('treats lease validity loss as stale context and executes no semantic effect', async () => {
    const harness = await buildHarness({ executionCurrent: () => false });

    await processMessageJob(job(harness), harness.deps);

    expect(harness.observations).toEqual([
      expect.objectContaining({ policyOutcome: 'stale_context', errorCode: 'STALE_CONTEXT' }),
    ]);
    expect(harness.sendMessage).toHaveBeenCalledOnce();
  });

  it.each([
    ['timeout', { status: 'failed', code: 'TIMEOUT', metadata: ROUTER_METADATA }],
    ['refusal', { status: 'failed', code: 'MODEL_REFUSAL', metadata: ROUTER_METADATA }],
    ['invalid schema', { status: 'proposed', providerBody: 'private provider response' }],
    [
      'forbidden action',
      {
        status: 'proposed',
        decision: { action: 'request_save_retry' },
        metadata: ROUTER_METADATA,
      },
    ],
  ])('keeps deterministic processing singular on provider %s', async (_name, result) => {
    const decide = vi.fn().mockResolvedValue(result);
    const harness = await buildHarness({ router: { decide } as SemanticRouterPort });

    await processMessageJob(job(harness), harness.deps);

    expect(harness.sendMessage).toHaveBeenCalledOnce();
    expect(harness.observations).toHaveLength(1);
    expect(harness.observations[0]?.policyOutcome).toMatch(/router_failure|forbidden_action/);
    expect(JSON.stringify(harness.observations)).not.toContain('providerBody');
  });

  it('falls back once when credentials make the provider unavailable', async () => {
    const harness = await buildHarness({ router: null });

    await processMessageJob(job(harness), harness.deps);

    expect(harness.routerDecide).not.toHaveBeenCalled();
    expect(harness.sendMessage).toHaveBeenCalledOnce();
    expect(harness.observations).toEqual([
      expect.objectContaining({ policyOutcome: 'router_failure', errorCode: 'PROVIDER_ERROR' }),
    ]);
  });

  it('fails closed for an unsupported configured state and still runs its handler once', async () => {
    const harness = await buildHarness({
      state: 'ONBOARDING_START',
      statePayload: { promptShown: false },
    });

    await processMessageJob(job(harness, 'continuar'), harness.deps);

    expect(harness.routerDecide).not.toHaveBeenCalled();
    expect(harness.sendMessage).toHaveBeenCalledOnce();
    expect(harness.observations).toEqual([
      expect.objectContaining({
        policyOutcome: 'invalid_context',
        errorCode: 'INVALID_STATE_CONTEXT',
      }),
    ]);
  });

  it('logs telemetry failure safely and does not suppress deterministic processing', async () => {
    const info = vi.fn(() => {
      throw new Error('provider response and raw message must not escape');
    });
    const error = vi.fn();
    const harness = await buildHarness({
      telemetry: new PinoSemanticRoutingTelemetry({ info, error } as never),
    });

    await processMessageJob(job(harness), harness.deps);

    expect(harness.sendMessage).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith({
      msg: 'Failed to record semantic routing telemetry',
      endpoint: 'PinoSemanticRoutingTelemetry.record',
      code: 'SEMANTIC_TELEMETRY_FAILED',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('raw message');
  });

  it('resolves already queued jobs under off mode without model calls or schema changes', async () => {
    const harness = await buildHarness({ mode: 'off' });
    const queuedBeforeRollback = job(harness, 'hola', 'queued-before-off');

    await processMessageJob(queuedBeforeRollback, harness.deps);

    expect(harness.routerDecide).not.toHaveBeenCalled();
    expect(harness.sendMessage).toHaveBeenCalledOnce();
    expect(harness.observations).toEqual([
      expect.objectContaining({ mode: 'off', policyOutcome: 'disabled' }),
    ]);
  });

  it('dispatches enabled idle recognition through one router and one extraction boundary', async () => {
    const harness = await buildHarness({ mode: 'enabled' });

    await processMessageJob(job(harness), harness.deps);

    expect(harness.routerDecide).toHaveBeenCalledOnce();
    expect(harness.registerExpenseInterpret).toHaveBeenCalledOnce();
    expect(harness.sendMessage).toHaveBeenCalledOnce();
    expect(harness.observations).toEqual([
      expect.objectContaining({
        mode: 'enabled',
        policyOutcome: 'allowed_enabled',
        proposedAction: 'register_expense',
        errorCode: null,
      }),
    ]);
  });

  it('keeps webhook acknowledgment/FIFO output equivalent in shadow and off modes', async () => {
    async function run(mode: 'off' | 'shadow', suffix: string) {
      const harness = await buildHarness({ mode, externalId: `1234567${suffix}` });
      const incomingJobs: IncomingMessageJobData[] = [];
      const processJobs: ProcessMessageJobData[] = [];
      const visible: string[] = [];
      harness.sendMessage.mockImplementation(async (_chatId: string, text: string) => {
        visible.push(text);
        return { status: 'success' };
      });
      const route = new RouteIncomingMessage({
        messageQueue: {
          add: vi.fn((_name: string, data: ProcessMessageJobData) => {
            processJobs.push(data);
            return Promise.resolve();
          }),
        } as unknown as Queue<ProcessMessageJobData>,
        resolveIdentity: new ResolveUserIdentityUseCase(harness.deps.userRepo, harness.stateRepo),
        handleUnsupportedMessage: new HandleUnsupportedMessage({
          sendMessage: harness.sendMessage,
        }),
        deterministicRoutingPolicy: harness.deps.deterministicRoutingPolicy,
        sendGuidance: harness.deps.sendGuidance,
        getConversationState: harness.deps.getConversationState,
        processedMessageRepository: new RedisProcessedMessageRepository(redis),
        semanticRoutingPolicy: harness.policy,
      });
      const app = Fastify({ logger: false });
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      const deps: TelegramWebhookDeps = {
        webhookSecret: WEBHOOK_SECRET,
        incomingMessageQueue: {
          add: vi.fn((_name: string, data: IncomingMessageJobData) => {
            incomingJobs.push(data);
            return Promise.resolve();
          }),
        } as unknown as Queue<IncomingMessageJobData>,
        handleStartCommand: { execute: vi.fn() } as never,
        sendImmediateAcknowledgement: new SendImmediateAcknowledgement({
          sendMessage: harness.sendMessage,
        }),
        resolveIdentity: new ResolveUserIdentityUseCase(harness.deps.userRepo, harness.stateRepo),
      };
      registerTelegramWebhook(app, deps);
      const startedAt = performance.now();
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        payload: {
          update_id: Number(suffix),
          message: {
            message_id: Number(suffix),
            from: { id: Number(harness.externalId) },
            chat: { id: Number(harness.externalId), type: 'private' },
            text: 'El banco avisa de un movimiento reciente en Mercadona',
            date: Math.floor(Date.now() / 1000),
          },
        },
      });
      const acknowledgmentMs = performance.now() - startedAt;
      await vi.waitFor(() => expect(visible).toHaveLength(1));
      expect(response.statusCode).toBe(200);
      expect(incomingJobs).toHaveLength(1);
      await processIncomingMessageJob(
        { data: incomingJobs[0] } as Job<IncomingMessageJobData>,
        route,
      );
      if (processJobs[0]) {
        await processMessageJob(
          { data: processJobs[0] } as Job<ProcessMessageJobData>,
          harness.deps,
        );
      }
      const state = await harness.stateRepo.findByUserId(harness.userId);
      await app.close();
      return { visible, acknowledgmentMs, observations: harness.observations, state, processJobs };
    }

    const shadow = await run('shadow', '81');
    const off = await run('off', '82');

    expect(shadow.visible).toEqual(off.visible);
    expect(shadow.state).toMatchObject({ currentState: 'IDLE', revision: '0' });
    expect(off.state).toMatchObject({ currentState: 'IDLE', revision: '0' });
    expect(shadow.processJobs).toHaveLength(1);
    expect(off.processJobs).toHaveLength(0);
    expect(shadow.observations).toHaveLength(1);
    expect(JSON.stringify(shadow.observations)).not.toMatch(
      /Mercadona|statePayload|optionId|operationId|revision|credential|providerBody|reasoning|123456781|messageId/,
    );
    expect(shadow.acknowledgmentMs).toBeLessThan(1_000);
    expect(off.acknowledgmentMs).toBeLessThan(1_000);
  });
});
