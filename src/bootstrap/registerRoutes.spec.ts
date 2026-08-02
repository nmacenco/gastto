// LAYER: Bootstrap / Unit Tests
// Tests for route registration: health, Telegram webhook and OAuth callback.

import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { registerRoutes } from './registerRoutes';
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
  CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD: 0.6,
  HIGH_AMOUNT_THRESHOLD_MULTIPLIER: 10,
  EXPENSE_REVIEW_TIMEOUT_MINUTES: 10,
  EXPENSE_REVIEW_REMINDER_TIMEOUT_MINUTES: 10,
  OPENAI_API_KEY: 'sk-test-openai',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  WEBHOOK_BASE_URL: 'https://example.com',
  ENCRYPTION_KEY: 'a'.repeat(64),
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
};

function buildMockDeps(partial: Partial<Dependencies> = {}): Dependencies {
  return {
    db: {} as Dependencies['db'],
    redis: {} as Dependencies['redis'],
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
    correctExpense: {} as Dependencies['correctExpense'],
    generateExpenseSummary: {} as Dependencies['generateExpenseSummary'],
    resolveExpenseSummaryAction: {} as Dependencies['resolveExpenseSummaryAction'],
    cancelExpenseRegistration: {} as Dependencies['cancelExpenseRegistration'],
    resolveExpenseReviewReply: {} as Dependencies['resolveExpenseReviewReply'],
    expenseSummaryPresenterFactory: {} as Dependencies['expenseSummaryPresenterFactory'],
    telegram: null,
    googleOAuth: null,
    ...partial,
  };
}

describe('registerRoutes', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('registers /health', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    registerRoutes(app, buildMockDeps(), baseEnv);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('registers the Telegram webhook when the Telegram feature is present', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    const deps = buildMockDeps({
      telegram: {
        adapter: {} as TelegramFeature['adapter'],
        handleStartCommand: {} as TelegramFeature['handleStartCommand'],
        sendImmediateAcknowledgement: {} as TelegramFeature['sendImmediateAcknowledgement'],
        handleUnsupportedMessage: {} as TelegramFeature['handleUnsupportedMessage'],
        classifyFreeTextExpenseIntent: {} as TelegramFeature['classifyFreeTextExpenseIntent'],
        sendExpenseGuidance: {} as TelegramFeature['sendExpenseGuidance'],
        processedMessageRepository: {} as TelegramFeature['processedMessageRepository'],
        routeIncomingMessage: {} as TelegramFeature['routeIncomingMessage'],
      },
    });

    registerRoutes(app, deps, baseEnv);

    expect(app.hasRoute({ method: 'POST', url: '/webhook/telegram' })).toBe(true);
  });

  it('does not register the Telegram webhook when the Telegram feature is absent', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    const deps = buildMockDeps({ telegram: null });

    registerRoutes(app, deps, baseEnv);

    const response = await app.inject({ method: 'POST', url: '/webhook/telegram' });

    expect(response.statusCode).toBe(404);
  });

  it('registers the Google OAuth callback when the feature is present', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    const deps = buildMockDeps({
      googleOAuth: {
        adapter: {} as GoogleOAuthFeature['adapter'],
        initiateCloudConnection: {} as GoogleOAuthFeature['initiateCloudConnection'],
        handleOAuthCallback: {} as GoogleOAuthFeature['handleOAuthCallback'],
        sendOAuthReminder: {} as GoogleOAuthFeature['sendOAuthReminder'],
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
      },
    });

    registerRoutes(app, deps, baseEnv);

    const response = await app.inject({ method: 'GET', url: '/auth/google/callback' });

    // 400 means the route exists and the query schema validation rejected the request
    expect(response.statusCode).toBe(400);
  });

  it('does not register the OAuth callback when the feature is absent', async () => {
    app = await createFastify(baseEnv, createLogger({ level: 'silent' }));
    const deps = buildMockDeps({ googleOAuth: null });

    registerRoutes(app, deps, baseEnv);

    const response = await app.inject({ method: 'GET', url: '/auth/google/callback' });

    expect(response.statusCode).toBe(404);
  });
});
