// LAYER: Bootstrap / Unit Tests
// Tests for worker registration: BullMQ workers are created with the right names/options
// and the Telegram webhook is auto-registered on startup.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Queue, Worker } from 'bullmq';

import { registerWorkers } from './registerWorkers';
import { createFastify } from './createFastify';
import { createLogger } from '../infrastructure/logger';
import type { Dependencies, TelegramFeature, GoogleOAuthFeature } from './types';
import type { Env } from '../config/env.schema';

const baseEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgres://localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379/0',
  MAPPING_CORRECTION_TTL_SECONDS: 1800,
  OPENAI_API_KEY: 'sk-test-openai',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  WEBHOOK_BASE_URL: 'https://example.com',
  ENCRYPTION_KEY: 'a'.repeat(64),
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
};

vi.mock('bullmq', () => ({
  Queue: vi.fn(),
  Worker: vi.fn(),
}));

function buildMockDeps(partial: Partial<Dependencies> = {}): Dependencies {
  return {
    db: {} as Dependencies['db'],
    redis: { on: vi.fn() } as unknown as Dependencies['redis'],
    rootLogger: createLogger({ level: 'silent' }),
    userRepo: {} as Dependencies['userRepo'],
    conversationRepo: {} as Dependencies['conversationRepo'],
    operationLogRepo: {} as Dependencies['operationLogRepo'],
    tokenRepo: {} as Dependencies['tokenRepo'],
    spreadsheetConfigRepo: {} as Dependencies['spreadsheetConfigRepo'],
    columnMappingRepo: {} as Dependencies['columnMappingRepo'],
    categoryVocabularyRepo: {} as Dependencies['categoryVocabularyRepo'],
    userCategoryRepo: {} as Dependencies['userCategoryRepo'],
    expenseRecordRepo: {} as Dependencies['expenseRecordRepo'],
    tokenEncryption: {} as Dependencies['tokenEncryption'],
    resolveIdentity: {} as Dependencies['resolveIdentity'],
    getConversationState: {} as Dependencies['getConversationState'],
    transitionState: {} as Dependencies['transitionState'],
    recoverCorruptedState: {} as Dependencies['recoverCorruptedState'],
    messageQueue: {} as Dependencies['messageQueue'],
    incomingMessageQueue: {} as Dependencies['incomingMessageQueue'],
    reminderQueue: {} as Dependencies['reminderQueue'],
    llmPort: {} as Dependencies['llmPort'],
    llmHeaderDetectionAdapter: {} as Dependencies['llmHeaderDetectionAdapter'],
    llmColumnInferenceAdapter: {} as Dependencies['llmColumnInferenceAdapter'],
    spreadsheetAccessAdapterFactory: {} as Dependencies['spreadsheetAccessAdapterFactory'],
    ruleBasedColumnInferenceAdapter: {} as Dependencies['ruleBasedColumnInferenceAdapter'],
    ruleBasedHeaderDetectionAdapter: {} as Dependencies['ruleBasedHeaderDetectionAdapter'],
    mappingCorrectionStateRepository: {} as Dependencies['mappingCorrectionStateRepository'],
    userProcessingLock: {} as Dependencies['userProcessingLock'],
    registerExpense: {} as Dependencies['registerExpense'],
    telegram: null,
    googleOAuth: null,
    ...partial,
  };
}

function buildTelegramFeature(): TelegramFeature {
  return {
    adapter: { sendMessage: vi.fn() } as unknown as TelegramFeature['adapter'],
    handleStartCommand: {} as TelegramFeature['handleStartCommand'],
    sendImmediateAcknowledgement: {} as TelegramFeature['sendImmediateAcknowledgement'],
    handleUnsupportedMessage: {} as TelegramFeature['handleUnsupportedMessage'],
    classifyFreeTextExpenseIntent: {} as TelegramFeature['classifyFreeTextExpenseIntent'],
    sendExpenseGuidance: {} as TelegramFeature['sendExpenseGuidance'],
    processedMessageRepository: {} as TelegramFeature['processedMessageRepository'],
    routeIncomingMessage: {
      execute: vi.fn(),
    } as unknown as TelegramFeature['routeIncomingMessage'],
  };
}

function buildGoogleOAuthFeature(): GoogleOAuthFeature {
  return {
    adapter: {} as GoogleOAuthFeature['adapter'],
    initiateCloudConnection: {} as GoogleOAuthFeature['initiateCloudConnection'],
    handleOAuthCallback: {} as GoogleOAuthFeature['handleOAuthCallback'],
    sendOAuthReminder: { execute: vi.fn() } as unknown as GoogleOAuthFeature['sendOAuthReminder'],
    cancelCloudConnection: {} as GoogleOAuthFeature['cancelCloudConnection'],
    driveFileDiscovery: {} as GoogleOAuthFeature['driveFileDiscovery'],
    sheetsAdapterFactory: {} as GoogleOAuthFeature['sheetsAdapterFactory'],
    categoryReaderFactory: {} as GoogleOAuthFeature['categoryReaderFactory'],
    handleSpreadsheetFileSelection: {} as GoogleOAuthFeature['handleSpreadsheetFileSelection'],
    handleSheetSelection: {} as GoogleOAuthFeature['handleSheetSelection'],
    validateSpreadsheetAccess: {} as GoogleOAuthFeature['validateSpreadsheetAccess'],
    inferColumnMapping: {} as GoogleOAuthFeature['inferColumnMapping'],
    confirmColumnMapping: {} as GoogleOAuthFeature['confirmColumnMapping'],
    correctColumnMapping: {} as GoogleOAuthFeature['correctColumnMapping'],
    detectCategories: {} as GoogleOAuthFeature['detectCategories'],
    confirmCategories: {} as GoogleOAuthFeature['confirmCategories'],
  };
}

describe('registerWorkers', () => {
  let app: FastifyInstance;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.mocked(Worker).mockImplementation(
      () =>
        ({
          opts: { concurrency: 1 },
          on: vi.fn(),
          close: vi.fn().mockResolvedValue(undefined),
        }) as unknown as Worker,
    );
    vi.mocked(Queue).mockImplementation(
      () =>
        ({
          add: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        }) as unknown as Queue,
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('creates the incoming-message worker when Telegram is configured', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    const deps = buildMockDeps({ telegram: buildTelegramFeature() });

    await registerWorkers(app, deps, baseEnv);

    const names = vi.mocked(Worker).mock.calls.map(([name]) => name);
    expect(names).toContain('incoming-message');
  });

  it('creates the process-message worker with the Google OAuth options', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    const deps = buildMockDeps({
      telegram: buildTelegramFeature(),
      googleOAuth: buildGoogleOAuthFeature(),
    });

    await registerWorkers(app, deps, baseEnv);

    const processMessageCall = vi
      .mocked(Worker)
      .mock.calls.find(([name]) => name === 'process-message');
    expect(processMessageCall).toBeDefined();
    const options = processMessageCall![2] as unknown as { concurrency: number };
    expect(options.concurrency).toBe(2);
  });

  it('auto-registers the Telegram webhook when WEBHOOK_BASE_URL is not localhost', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    const deps = buildMockDeps({
      telegram: buildTelegramFeature(),
      googleOAuth: buildGoogleOAuthFeature(),
    });

    await registerWorkers(app, deps, baseEnv);

    const setWebhookCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/setWebhook'),
    );
    expect(setWebhookCalls.length).toBeGreaterThan(0);
  });

  it('skips Telegram webhook auto-registration for localhost', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    const deps = buildMockDeps({
      telegram: buildTelegramFeature(),
      googleOAuth: buildGoogleOAuthFeature(),
    });
    const env: Env = { ...baseEnv, WEBHOOK_BASE_URL: 'http://localhost:3000' };

    await registerWorkers(app, deps, env);

    const setWebhookCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/setWebhook'),
    );
    expect(setWebhookCalls).toHaveLength(0);
  });

  it('creates the oauth-reminder worker when Google OAuth is configured', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    const deps = buildMockDeps({
      telegram: buildTelegramFeature(),
      googleOAuth: buildGoogleOAuthFeature(),
    });

    await registerWorkers(app, deps, baseEnv);

    const names = vi.mocked(Worker).mock.calls.map(([name]) => name);
    expect(names).toContain('oauth-reminder');
  });

  it('creates the session-timeout worker', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    const deps = buildMockDeps({
      telegram: buildTelegramFeature(),
      googleOAuth: buildGoogleOAuthFeature(),
    });

    await registerWorkers(app, deps, baseEnv);

    const names = vi.mocked(Worker).mock.calls.map(([name]) => name);
    expect(names).toContain('session-timeout');
  });

  it('does not create any worker when Telegram is not configured', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    const deps = buildMockDeps({ telegram: null, googleOAuth: buildGoogleOAuthFeature() });

    await registerWorkers(app, deps, baseEnv);

    expect(Worker).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
