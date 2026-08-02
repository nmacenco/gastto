// LAYER: Bootstrap
// Creates BullMQ workers and auto-registers the Telegram webhook on startup.

import { Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';

import type { Env } from '../config/env.schema';
import type { Dependencies } from './types';
import { TelegramWebhookConfigurator } from '../infrastructure/adapters/telegram/TelegramWebhookConfigurator';
import { HandleExpiredSessions } from '../application/use-cases/conversation/HandleExpiredSessions';
import { createIncomingMessageWorker } from '../interfaces/workers/incomingMessage.worker';
import { createMessageWorker } from '../interfaces/workers/message.worker';
import { createSessionTimeoutWorker } from '../interfaces/workers/sessionTimeout.worker';
import { createOAuthReminderWorker } from '../interfaces/workers/oauthReminder.worker';

/**
 * Starts all background workers and auto-registers the Telegram webhook.
 *
 * Does nothing when Telegram is not configured. The OAuth reminder worker
 * is only started when the Google OAuth feature bundle is present.
 */
export async function registerWorkers(
  app: FastifyInstance,
  deps: Dependencies,
  env: Env,
): Promise<void> {
  if (deps.telegram === null) {
    return;
  }

  const { adapter: telegramAdapter, routeIncomingMessage } = deps.telegram;

  // Thin FIFO worker (ADR-011): guarantees per-user message ordering
  const incomingMessageWorker = createIncomingMessageWorker({
    redis: deps.redis,
    routeIncomingMessage,
    logger: deps.rootLogger,
  });
  app.log.info(
    `Started incoming-message worker (concurrency: ${incomingMessageWorker.opts.concurrency})`,
  );

  // Thick worker (ADR-005): FSM → NLP → user response
  const messageWorker = createMessageWorker({
    redis: deps.redis,
    logger: deps.rootLogger,
    userProcessingLock: deps.userProcessingLock,
    registerExpense: deps.registerExpense,
    correctExpense: deps.correctExpense,
    generateExpenseSummary: deps.generateExpenseSummary,
    resolveExpenseSummaryAction: deps.resolveExpenseSummaryAction,
    cancelExpenseRegistration: deps.cancelExpenseRegistration,
    resolveExpenseReviewReply: deps.resolveExpenseReviewReply,
    getConversationState: deps.getConversationState,
    transitionState: deps.transitionState,
    recoverCorruptedState: deps.recoverCorruptedState,
    userRepo: deps.userRepo,
    messagingAdapters: {
      telegram: telegramAdapter,
      // TODO: replace with real WhatsApp adapter when implemented
      whatsapp: telegramAdapter,
    },
    expenseSummaryPresenterFactory: deps.expenseSummaryPresenterFactory,
    mappingCorrectionStateRepository: deps.mappingCorrectionStateRepository,
    initiateCloudConnection: deps.googleOAuth?.initiateCloudConnection ?? null,
    cancelCloudConnection: deps.googleOAuth?.cancelCloudConnection ?? null,
    handleSpreadsheetFileSelection: deps.googleOAuth?.handleSpreadsheetFileSelection ?? null,
    handleSheetSelection: deps.googleOAuth?.handleSheetSelection ?? null,
    validateSpreadsheetAccess: deps.googleOAuth?.validateSpreadsheetAccess ?? null,
    inferColumnMapping: deps.googleOAuth?.inferColumnMapping ?? null,
    confirmColumnMapping: deps.googleOAuth?.confirmColumnMapping ?? null,
    correctColumnMapping: deps.googleOAuth?.correctColumnMapping ?? null,
    detectCategories: deps.googleOAuth?.detectCategories ?? null,
    confirmCategories: deps.googleOAuth?.confirmCategories ?? null,
  });
  app.log.info(`Started process-message worker (concurrency: ${messageWorker.opts.concurrency})`);

  // Auto-register Telegram webhook on startup so Telegram knows where to deliver updates.
  // Skip for localhost since Telegram servers cannot reach local addresses.
  const isLocalhost = /^(https?:\/\/)?(localhost|127\.0\.0\.1)/i.test(env.WEBHOOK_BASE_URL);
  if (!isLocalhost) {
    try {
      const webhookUrl = `${env.WEBHOOK_BASE_URL.replace(/\/$/, '')}/webhook/telegram`;
      const configurator = new TelegramWebhookConfigurator(env.TELEGRAM_BOT_TOKEN);
      await configurator.setWebhook(webhookUrl, env.TELEGRAM_WEBHOOK_SECRET);
      app.log.info(`Telegram webhook registered: ${webhookUrl}`);
    } catch (err) {
      app.log.error({ msg: 'Failed to register Telegram webhook', error: err });
    }
  } else {
    app.log.warn('WEBHOOK_BASE_URL is localhost — Telegram webhook auto-registration skipped');
  }

  if (deps.googleOAuth !== null) {
    const oauthReminderWorker = createOAuthReminderWorker({
      redis: deps.redis,
      logger: deps.rootLogger,
      sendOAuthReminder: deps.googleOAuth.sendOAuthReminder,
      redirectUri: env.GOOGLE_REDIRECT_URI,
    });
    app.log.info(
      `Started oauth-reminder worker (concurrency: ${oauthReminderWorker.opts.concurrency})`,
    );
  }

  // Session timeout worker — periodic job that transitions expired states to IDLE
  try {
    const sessionTimeoutQueue = new Queue('session-timeout', {
      connection: deps.redis,
    });
    await sessionTimeoutQueue.add('session-timeout', {}, { repeat: { every: 120_000 } });

    const handleExpiredSessions = new HandleExpiredSessions(
      deps.conversationRepo,
      deps.userRepo,
      deps.transitionState,
      telegramAdapter,
      deps.expenseSummaryPresenterFactory,
      env.EXPENSE_REVIEW_REMINDER_TIMEOUT_MINUTES,
      deps.rootLogger,
    );

    createSessionTimeoutWorker({
      redis: deps.redis,
      handleExpiredSessions,
      logger: deps.rootLogger,
    });
    app.log.info('Started session-timeout worker (repeat every 60s)');
  } catch (err) {
    app.log.error({ msg: 'Failed to start session-timeout worker', error: err });
  }
}
