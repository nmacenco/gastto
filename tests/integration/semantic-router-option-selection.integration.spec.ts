import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { DrizzleSpreadsheetConfigRepository } from '../../src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository';
import { DrizzleUserRepository } from '../../src/infrastructure/db/repositories/DrizzleUserRepository';
import { RedisProcessedMessageRepository } from '../../src/infrastructure/redis/RedisProcessedMessageRepository';
import { RedisUserProcessingLock } from '../../src/infrastructure/redis/RedisUserProcessingLock';
import { TransitionConversationState } from '../../src/application/use-cases/conversation/TransitionConversationState';
import { ValidateConversationSnapshot } from '../../src/application/services/semantic-router/ValidateConversationSnapshot';
import {
  projectOptionSelectionSnapshot,
  ResolveOptionReference,
} from '../../src/application/services/semantic-router/ResolveOptionReference';
import { DispatchOptionSelection } from '../../src/application/use-cases/spreadsheet/DispatchOptionSelection';
import { HandleSpreadsheetFileSelection } from '../../src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection';
import { HandleSheetSelection } from '../../src/application/use-cases/spreadsheet/HandleSheetSelection';
import type { ConversationState } from '../../src/domain/entities/ConversationState';
import {
  Sha256SemanticRoutingPolicy,
  type SemanticRoutingMode,
} from '../../src/application/services/semantic-router/runtime-policy';
import { RouteIncomingMessage } from '../../src/application/use-cases/conversation/RouteIncomingMessage';
import { ResolveUserIdentityUseCase } from '../../src/application/use-cases/user/ResolveUserIdentity';
import { HandleUnsupportedMessage } from '../../src/application/use-cases/conversation/HandleUnsupportedMessage';
import { GetConversationState } from '../../src/application/use-cases/conversation/GetConversationState';
import { CurrentDeterministicRoutingPolicy } from '../../src/application/services/semantic-router/deterministic-routing';
import { ClassifyFreeTextExpenseIntent } from '../../src/application/use-cases/conversation/ClassifyFreeTextExpenseIntent';
import type { ProcessMessageJobData } from '../../src/application/ports/ProcessMessageJob';

type Database = PostgresJsDatabase<typeof schema>;

const files = [
  {
    id: 'file-1',
    name: 'Planilla familiar',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    modifiedAt: '2026-09-17T10:00:00.000Z',
  },
  {
    id: 'file-2',
    name: 'Presupuesto',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    modifiedAt: '2026-09-16T10:00:00.000Z',
  },
];
const sheets = [
  { name: 'Resumen', index: 0 },
  { name: 'Movimientos', index: 1 },
];

describe.skipIf(!isDockerAvailable())('Integration :: semantic router option selection', () => {
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

  async function buildHarness(
    initialState: 'ONBOARDING_FILE' | 'ONBOARDING_SHEET' = 'ONBOARDING_FILE',
    statePayload: Record<string, unknown> = { fileList: files },
  ) {
    const user = await createUser(db);
    await createConversationState(db, {
      userId: user.userId,
      currentState: initialState,
      statePayload,
    });
    const stateRepo = new DrizzleConversationStateRepository(db);
    const configRepo = new DrizzleSpreadsheetConfigRepository(db);
    const transitionState = new TransitionConversationState(stateRepo);
    let executionCurrent = true;
    const snapshotValidator = new ValidateConversationSnapshot(stateRepo, () => executionCurrent);
    const messages: string[] = [];
    const probe = vi.fn().mockResolvedValue({ nextState: 'ONBOARDING_MAPPING', message: 'ok' });
    const listSheets = vi.fn().mockResolvedValue(sheets);
    const getHeaders = vi.fn().mockResolvedValue(['Fecha', 'Monto']);
    const validateFileAccess = vi.fn().mockResolvedValue(true);
    const messaging = {
      sendMessage: vi.fn(async (_externalId: string, message: string) => {
        messages.push(message);
        return { status: 'success' as const };
      }),
    };
    const oauth = {
      getValidAccessToken: vi.fn().mockResolvedValue({
        accessToken: 'integration-token',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        refreshed: false,
      }),
      forceRefreshAccessToken: vi.fn(),
    };
    const logger = { error: vi.fn() };
    const sheetSelection = new HandleSheetSelection({
      spreadsheetPortFactory: { create: vi.fn(() => ({ listSheets, getHeaders })) } as never,
      oauthAccessTokenService: oauth,
      transitionState,
      messagingPort: messaging,
      spreadsheetConfigRepository: configRepo,
      validateSpreadsheetAccess: { execute: probe } as never,
      logger: logger as never,
    });
    const fileSelection = new HandleSpreadsheetFileSelection({
      cloudStorage: {
        listRecentSpreadsheets: vi.fn().mockResolvedValue(files),
        searchSpreadsheets: vi.fn().mockResolvedValue(files),
        validateFileAccess,
        getFileById: vi.fn(),
      },
      oauthAccessTokenService: oauth,
      transitionState,
      messagingPort: messaging,
      logger: logger as never,
      handleSheetSelection: sheetSelection,
    });
    const dispatch = new DispatchOptionSelection({
      snapshotValidator,
      resolver: new ResolveOptionReference(),
      fileSelection,
      sheetSelection,
    });
    return {
      userId: user.userId,
      stateRepo,
      configRepo,
      transitionState,
      dispatch,
      sheetSelection,
      probe,
      listSheets,
      getHeaders,
      validateFileAccess,
      messages,
      logger,
      loseLease: () => {
        executionCurrent = false;
        transitionState.invalidateExecution(user.userId);
      },
    };
  }

  function dispatchInput(userId: string, state: ConversationState, userReference: string) {
    const snapshot = projectOptionSelectionSnapshot(state);
    if (!snapshot) throw new Error('Expected option snapshot');
    return {
      userId,
      externalId: 'chat-1',
      channel: 'telegram' as const,
      conversationState: state,
      expected: {
        revision: state.revision,
        currentState: state.currentState,
        expiry: 'unexpired' as const,
      },
      snapshot,
      decision: { action: 'select_option' as const, userReference },
    };
  }

  async function dispatchCurrent(
    harness: Awaited<ReturnType<typeof buildHarness>>,
    reference: string,
  ) {
    const state = (await harness.stateRepo.findByUserId(harness.userId))!;
    return harness.transitionState.runWithState(state, () =>
      harness.dispatch.execute(dispatchInput(harness.userId, state, reference)),
    );
  }

  it('selects a natural file then sheet, persists once, and only then starts the probe', async () => {
    const harness = await buildHarness();

    await expect(dispatchCurrent(harness, 'Planilla familiar')).resolves.toEqual({
      status: 'selected',
      target: 'file',
    });
    const sheetState = await harness.stateRepo.findByUserId(harness.userId);
    expect(sheetState).toMatchObject({ currentState: 'ONBOARDING_SHEET' });
    expect(sheetState?.statePayload).toMatchObject({
      selectedFileId: 'file-1',
      selectedFileName: 'Planilla familiar',
      sheetList: sheets,
    });

    harness.probe.mockImplementationOnce(async () => {
      await expect(harness.configRepo.findByUserId(harness.userId)).resolves.toMatchObject({
        fileId: 'file-1',
        sheetName: 'Movimientos',
      });
      return { nextState: 'ONBOARDING_MAPPING', message: 'ok' };
    });
    await expect(dispatchCurrent(harness, 'la segunda hoja')).resolves.toEqual({
      status: 'selected',
      target: 'sheet',
    });
    expect(harness.validateFileAccess).toHaveBeenCalledOnce();
    expect(harness.probe).toHaveBeenCalledOnce();
    await expect(harness.configRepo.findByUserId(harness.userId)).resolves.toMatchObject({
      fileName: 'Planilla familiar',
      sheetName: 'Movimientos',
    });
  });

  it('preserves selected-file identity through IDK and then selects naturally', async () => {
    const harness = await buildHarness('ONBOARDING_SHEET', {
      selectedFileId: 'file-1',
      selectedFileName: 'Planilla familiar',
      provider: 'google',
      sheetList: sheets,
    });
    const state = (await harness.stateRepo.findByUserId(harness.userId))!;
    await harness.transitionState.runWithState(state, () =>
      harness.sheetSelection.execute({
        userId: harness.userId,
        externalId: 'chat-1',
        channel: 'telegram',
        rawMessage: 'no sé',
        statePayload: state.statePayload,
      }),
    );

    const idkState = await harness.stateRepo.findByUserId(harness.userId);
    expect(idkState?.statePayload).toMatchObject({
      selectedFileId: 'file-1',
      selectedFileName: 'Planilla familiar',
      provider: 'google',
      step: 'idk',
    });
    await expect(dispatchCurrent(harness, 'Movimientos')).resolves.toEqual({
      status: 'selected',
      target: 'sheet',
    });
    expect(harness.getHeaders).toHaveBeenCalledTimes(2);
    await expect(harness.configRepo.findByUserId(harness.userId)).resolves.toMatchObject({
      fileId: 'file-1',
      fileName: 'Planilla familiar',
      sheetName: 'Movimientos',
    });
  });

  it('rejects duplicate normalized names without persistence, transition, success copy, or probe', async () => {
    const harness = await buildHarness('ONBOARDING_SHEET', {
      selectedFileId: 'file-1',
      selectedFileName: 'Planilla familiar',
      provider: 'google',
      sheetList: [
        { name: 'Gastos', index: 0 },
        { name: 'Gástos', index: 1 },
      ],
    });
    const before = (await harness.stateRepo.findByUserId(harness.userId))!;

    await expect(dispatchCurrent(harness, 'gastos')).resolves.toEqual({
      status: 'clarification_required',
      reason: 'ambiguous_reference',
    });
    await expect(harness.configRepo.findByUserId(harness.userId)).resolves.toBeNull();
    await expect(harness.stateRepo.findByUserId(harness.userId)).resolves.toMatchObject({
      revision: before.revision,
      currentState: 'ONBOARDING_SHEET',
    });
    expect(harness.probe).not.toHaveBeenCalled();
    expect(harness.messages).toEqual([]);
  });

  it('rejects stale and lease-lost replies before persistence or external effects', async () => {
    const harness = await buildHarness('ONBOARDING_SHEET', {
      selectedFileId: 'file-1',
      selectedFileName: 'Planilla familiar',
      provider: 'google',
      sheetList: sheets,
    });
    const observed = (await harness.stateRepo.findByUserId(harness.userId))!;
    const staleInput = dispatchInput(harness.userId, observed, 'Movimientos');
    await harness.stateRepo.transition({
      userId: harness.userId,
      expected: {
        revision: observed.revision,
        currentState: observed.currentState,
        expiry: 'any',
      },
      nextState: 'ONBOARDING_SHEET',
      payload: { ...observed.statePayload, sheetList: [...sheets].reverse() },
      expiresAt: null,
    });

    await expect(harness.dispatch.execute(staleInput)).resolves.toEqual({
      status: 'clarification_required',
      reason: 'stale_context',
    });
    harness.loseLease();
    await expect(dispatchCurrent(harness, 'Resumen')).resolves.toEqual({
      status: 'clarification_required',
      reason: 'stale_context',
    });
    await expect(harness.configRepo.findByUserId(harness.userId)).resolves.toBeNull();
    expect(harness.probe).not.toHaveBeenCalled();
  });

  it('admits duplicate delivery once and performs one sheet selection', async () => {
    const harness = await buildHarness('ONBOARDING_SHEET', {
      selectedFileId: 'file-1',
      selectedFileName: 'Planilla familiar',
      provider: 'google',
      sheetList: sheets,
    });
    const externalId = 'duplicate-sheet-chat';
    await createMessagingIdentity(db, { userId: harness.userId, externalId });
    const processed = new RedisProcessedMessageRepository(redis);
    const jobs: ProcessMessageJobData[] = [];
    const route = new RouteIncomingMessage({
      messageQueue: {
        add: vi.fn((_name: string, data: ProcessMessageJobData) => {
          jobs.push(data);
          return Promise.resolve();
        }),
      } as never,
      resolveIdentity: new ResolveUserIdentityUseCase(
        new DrizzleUserRepository(db, redis),
        harness.stateRepo,
      ),
      processedMessageRepository: processed,
      handleUnsupportedMessage: new HandleUnsupportedMessage({ sendMessage: vi.fn() }),
      deterministicRoutingPolicy: new CurrentDeterministicRoutingPolicy(
        new ClassifyFreeTextExpenseIntent(),
      ),
      sendGuidance: { execute: vi.fn() } as never,
      getConversationState: new GetConversationState(harness.stateRepo),
      semanticRoutingPolicy: new Sha256SemanticRoutingPolicy({
        stateModes: { ONBOARDING_SHEET: 'enabled' },
        cohortPercent: 100,
        shadowSamplePercent: 100,
        cohortSeed: 'duplicate-sheet',
      }),
    });
    const payload = {
      messageType: 'TEXT' as const,
      chatId: externalId,
      userId: externalId,
      text: 'Movimientos',
      timestamp: new Date(),
      channel: 'telegram' as const,
      externalMessageId: 'sheet-selection-1',
      rawPayload: {},
    };

    await route.execute(payload);
    await route.execute(payload);
    expect(jobs).toHaveLength(1);

    await dispatchCurrent(harness, jobs[0]!.rawMessage);
    expect(harness.probe).toHaveBeenCalledOnce();
    await expect(harness.configRepo.findByUserId(harness.userId)).resolves.toMatchObject({
      sheetName: 'Movimientos',
    });
  });

  it('keeps config and state unchanged when the upsert fails before the guarded transition', async () => {
    const harness = await buildHarness('ONBOARDING_SHEET', {
      selectedFileId: 'file-1',
      selectedFileName: 'Planilla familiar',
      provider: 'google',
      sheetList: sheets,
    });
    const before = (await harness.stateRepo.findByUserId(harness.userId))!;
    vi.spyOn(harness.configRepo, 'upsertByUserId').mockRejectedValueOnce(new Error('db down'));

    await expect(dispatchCurrent(harness, 'Movimientos')).rejects.toThrow('db down');
    await expect(harness.configRepo.findByUserId(harness.userId)).resolves.toBeNull();
    await expect(harness.stateRepo.findByUserId(harness.userId)).resolves.toMatchObject({
      revision: before.revision,
      currentState: 'ONBOARDING_SHEET',
    });
    expect(harness.probe).not.toHaveBeenCalled();
    expect(harness.messages).toEqual([]);
  });

  it('retains the persisted selection and recovery state when access validation fails or falls back', async () => {
    const failed = await buildHarness('ONBOARDING_SHEET', {
      selectedFileId: 'file-1',
      selectedFileName: 'Planilla familiar',
      provider: 'google',
      sheetList: sheets,
    });
    failed.probe.mockRejectedValueOnce(new Error('probe failed'));
    await expect(dispatchCurrent(failed, 'Movimientos')).resolves.toEqual({
      status: 'selected',
      target: 'sheet',
    });
    await expect(failed.configRepo.findByUserId(failed.userId)).resolves.toMatchObject({
      sheetName: 'Movimientos',
    });
    await expect(failed.stateRepo.findByUserId(failed.userId)).resolves.toMatchObject({
      currentState: 'ONBOARDING_VALIDATING_ACCESS',
    });
    expect(failed.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'POST_SHEET_VALIDATING_ACCESS_FAILED' }),
    );

    const empty = await buildHarness('ONBOARDING_SHEET', {
      selectedFileId: 'file-1',
      selectedFileName: 'Planilla familiar',
      provider: 'google',
      sheetList: sheets,
    });
    empty.probe.mockImplementationOnce(async (input: { statePayload: Record<string, unknown> }) => {
      await empty.transitionState.execute({
        userId: empty.userId,
        targetState: 'ONBOARDING_SHEET',
        payload: { ...input.statePayload, step: 'empty-sheet-confirm' },
      });
      return { nextState: 'ONBOARDING_SHEET', message: 'empty' };
    });
    await dispatchCurrent(empty, 'Movimientos');
    await expect(empty.stateRepo.findByUserId(empty.userId)).resolves.toMatchObject({
      currentState: 'ONBOARDING_SHEET',
      statePayload: { selectedSheetName: 'Movimientos', step: 'empty-sheet-confirm' },
    });
    expect(empty.probe).toHaveBeenCalledOnce();
  });

  it('serializes duplicate work and preserves active snapshots across enabled, shadow, and off rollback', async () => {
    const harness = await buildHarness('ONBOARDING_SHEET', {
      selectedFileId: 'file-1',
      selectedFileName: 'Planilla familiar',
      provider: 'google',
      sheetList: sheets,
      step: 'idk',
    });
    const lock = new RedisUserProcessingLock(redis);
    const token = await lock.acquire(harness.userId, 30_000);
    expect(token).not.toBeNull();
    await expect(lock.acquire(harness.userId, 30_000)).resolves.toBeNull();
    await lock.release(harness.userId, token!);

    const modes: Record<string, SemanticRoutingMode> = { ONBOARDING_SHEET: 'enabled' };
    const policy = new Sha256SemanticRoutingPolicy({
      stateModes: modes,
      cohortPercent: 100,
      shadowSamplePercent: 100,
      cohortSeed: 'option-rollback',
    });
    const resolve = () =>
      policy.resolve({
        userId: harness.userId,
        externalMessageId: 'already-queued',
        state: 'ONBOARDING_SHEET',
        substep: 'idk',
        messageKind: 'free_text',
        providerAvailable: true,
      });
    expect(resolve().mode).toBe('enabled');
    modes.ONBOARDING_SHEET = 'shadow';
    expect(resolve().mode).toBe('shadow');
    modes.ONBOARDING_SHEET = 'off';
    expect(resolve()).toEqual({ mode: 'off', reason: 'state_off' });
    await expect(harness.stateRepo.findByUserId(harness.userId)).resolves.toMatchObject({
      currentState: 'ONBOARDING_SHEET',
      statePayload: { step: 'idk', sheetList: sheets },
    });

    const state = (await harness.stateRepo.findByUserId(harness.userId))!;
    await harness.transitionState.runWithState(state, () =>
      harness.sheetSelection.execute({
        userId: harness.userId,
        externalId: 'chat-1',
        channel: 'telegram',
        rawMessage: '2',
        statePayload: state.statePayload,
      }),
    );
    await expect(harness.configRepo.findByUserId(harness.userId)).resolves.toMatchObject({
      sheetName: 'Movimientos',
    });
  });
});
