// LAYER: Interfaces
// Application entry point. Assembles all layers following
// the dependency inversion principle: Domain <- Application <- Infrastructure <- Interfaces.
// A single persistent process starts Fastify + BullMQ workers (ADR-009, ADR-011).

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { z } from 'zod';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as Sentry from '@sentry/node';

import { env } from '@config/env';
import { createLogger } from './infrastructure/logger';

// Infrastructure
import { DrizzleUserRepository } from './infrastructure/db/repositories/DrizzleUserRepository';
import { DrizzleConversationStateRepository } from './infrastructure/db/repositories/DrizzleConversationStateRepository';
import { DrizzleOperationLogRepository } from './infrastructure/db/repositories/DrizzleOperationLogRepository';
import { DrizzleOAuthTokenRepository } from './infrastructure/db/repositories/DrizzleOAuthTokenRepository';
import { TelegramMessengerAdapter } from './infrastructure/adapters/telegram/TelegramMessengerAdapter';
import { TelegramWebhookConfigurator } from './infrastructure/adapters/telegram/TelegramWebhookConfigurator';
import { GoogleDriveOAuthAdapter } from './infrastructure/adapters/oauth';
import { GoogleDriveFileDiscoveryAdapter } from './infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter';
import { TokenEncryptionAdapter } from './infrastructure/security/TokenEncryptionAdapter';

// Application
import { ResolveUserIdentityUseCase } from './application/use-cases/user/ResolveUserIdentity';
import { InitiateCloudConnection } from './application/use-cases/spreadsheet/InitiateCloudConnection';
import { HandleOAuthCallback } from './application/use-cases/spreadsheet/HandleOAuthCallback';
import { SendOAuthReminder } from './application/use-cases/spreadsheet/SendOAuthReminder';
import { CancelCloudConnection } from './application/use-cases/spreadsheet/CancelCloudConnection';
import { HandleSpreadsheetFileSelection } from './application/use-cases/spreadsheet/HandleSpreadsheetFileSelection';
import { HandleStartCommand } from './application/use-cases/conversation/HandleStartCommand';
import { HandleUnsupportedMessage } from './application/use-cases/conversation/HandleUnsupportedMessage';
import { RouteIncomingMessage } from './application/use-cases/conversation/RouteIncomingMessage';
import { TransitionConversationState } from './application/use-cases/conversation/TransitionConversationState';
import { RecoverCorruptedState } from './application/use-cases/conversation/RecoverCorruptedState';
import { GetConversationState } from './application/use-cases/conversation/GetConversationState';
import { HandleExpiredSessions } from './application/use-cases/conversation/HandleExpiredSessions';
import type { ProcessMessageJobData } from './application/ports/ProcessMessageJob';
import type { IncomingMessageJobData } from './application/ports/IncomingMessageJob';

// Interfaces
import { registerTelegramWebhook } from './interfaces/http/routes/telegram.webhook';
import { registerOAuthCallback } from './interfaces/http/routes/oauth.callback';
import { createIncomingMessageWorker } from './interfaces/workers/incomingMessage.worker';
import { createMessageWorker } from './interfaces/workers/message.worker';
import { createSessionTimeoutWorker } from './interfaces/workers/sessionTimeout.worker';
import { createOAuthReminderWorker } from './interfaces/workers/oauthReminder.worker';

async function bootstrap(): Promise<void> {
  // -- Structured logger (ADR-013) ---------------------------------------------
  const rootLogger = createLogger({
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV !== 'production',
  });

  // -- Sentry: inicializar antes que todo (ADR -- observabilidad) -------------
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
    });
  }

  // -- Fastify ----------------------------------------------------------------
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // pino-pretty in development; structured JSON in production (Fly.io)
      ...(env.NODE_ENV !== 'production' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }),
    },
  });

  await app.register(helmet);
  await app.register(sensible);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Gastto API',
        description: 'Asistente financiero conversacional — API & Webhooks',
        version: '0.1.0',
      },
      tags: [
        { name: 'Health', description: 'System health checks' },
        { name: 'Webhooks', description: 'External messaging webhooks' },
        { name: 'Auth', description: 'OAuth provider callbacks' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/documentation',
  });

  // Wire Sentry into Fastify error handling
  const previousErrorHandler = app.errorHandler;
  app.setErrorHandler((error, request, reply) => {
    Sentry.captureException(error);
    return previousErrorHandler(error, request, reply);
  });

  // Health check para Fly.io
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        description: 'Returns system health status',
        response: {
          200: z.object({
            status: z.literal('ok'),
            ts: z.string().datetime(),
          }),
        },
      },
    },
    () => ({
      status: 'ok' as const,
      ts: new Date().toISOString(),
    }),
  );

  // -- Infraestructura condicional (solo cuando las env vars estan presentes) --
  if (env.DATABASE_URL && env.REDIS_URL) {
    try {
      const sql = postgres(env.DATABASE_URL);
      const db = drizzle(sql);
      const redis = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
        // Fly.io Upstash Redis requiere TLS (rediss://). Si el URL usa redis:// sin TLS,
        // la conexion sera reseteada por el proxy de Fly.io (ECONNRESET).
        // Verifica: fly secrets list | grep REDIS_URL
      });

      // Prevent Redis connection errors from crashing the process (ECONNRESET on Fly.io)
      redis.on('error', (err) => {
        app.log.error({
          msg: 'Redis connection error',
          error: err.message,
          code: (err as NodeJS.ErrnoException).code,
        });
      });

      // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
      const userRepo = new DrizzleUserRepository(db, redis);
      // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
      const conversationRepo = new DrizzleConversationStateRepository(db);
      // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
      const operationLogRepo = new DrizzleOperationLogRepository(db);
      // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
      const tokenRepo = new DrizzleOAuthTokenRepository(db);

      const tokenEncryption = new TokenEncryptionAdapter(env.ENCRYPTION_KEY);

      const resolveIdentity = new ResolveUserIdentityUseCase(userRepo, conversationRepo);
      const getConversationState = new GetConversationState(conversationRepo);
      const transitionState = new TransitionConversationState(conversationRepo);
      const recoverCorruptedState = new RecoverCorruptedState(conversationRepo, operationLogRepo);

      const messageQueue = new Queue<ProcessMessageJobData>('process-message', {
        connection: redis,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      });

      const incomingMessageQueue = new Queue<IncomingMessageJobData>('incoming-message', {
        connection: redis,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      });

      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET) {
        const telegramAdapter = new TelegramMessengerAdapter(env.TELEGRAM_BOT_TOKEN, rootLogger);
        const handleStartCommand = new HandleStartCommand(telegramAdapter, conversationRepo);

        const handleUnsupportedMessage = new HandleUnsupportedMessage(telegramAdapter);
        const routeIncomingMessage = new RouteIncomingMessage({
          messageQueue,
          resolveIdentity,
          messagingPort: telegramAdapter,
          handleUnsupportedMessage,
          logger: rootLogger,
        });

        // Thin FIFO worker (ADR-011): guarantees per-user message ordering
        const incomingMessageWorker = createIncomingMessageWorker({
          redis,
          routeIncomingMessage,
          logger: rootLogger,
        });
        app.log.info(
          `Started incoming-message worker (concurrency: ${incomingMessageWorker.opts.concurrency})`,
        );

        // Google Drive OAuth adapter (optional until credentials are configured)
        const googleOAuthAdapter =
          env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI
            ? new GoogleDriveOAuthAdapter({
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET,
                redirectUri: env.GOOGLE_REDIRECT_URI,
              })
            : null;

        const reminderQueue = new Queue('oauth-reminder', {
          connection: redis,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        });

        const initiateCloudConnection =
          googleOAuthAdapter !== null
            ? new InitiateCloudConnection({
                oauthService: googleOAuthAdapter,
                redis,
                reminderQueue,
                transitionState,
                messagingPort: telegramAdapter,
                redirectUri: env.GOOGLE_REDIRECT_URI,
              })
            : null;

        const handleOAuthCallback =
          googleOAuthAdapter !== null
            ? new HandleOAuthCallback({
                redis,
                logger: rootLogger,
                oauthService: googleOAuthAdapter,
                tokenRepository: tokenRepo,
                reminderQueue,
                transitionState,
                messagingPort: telegramAdapter,
                tokenEncryption,
              })
            : null;

        const sendOAuthReminder =
          googleOAuthAdapter !== null
            ? new SendOAuthReminder({
                redis,
                oauthService: googleOAuthAdapter,
                tokenRepository: tokenRepo,
                conversationRepo,
                reminderQueue,
                transitionState,
                messagingPort: telegramAdapter,
              })
            : null;

        const cancelCloudConnection =
          googleOAuthAdapter !== null
            ? new CancelCloudConnection({
                redis,
                reminderQueue,
                transitionState,
                messagingPort: telegramAdapter,
                logger: rootLogger,
              })
            : null;

        const googleDriveFileDiscovery =
          googleOAuthAdapter !== null ? new GoogleDriveFileDiscoveryAdapter(rootLogger) : null;

        const handleSpreadsheetFileSelection =
          googleDriveFileDiscovery !== null
            ? new HandleSpreadsheetFileSelection({
                cloudStorage: googleDriveFileDiscovery,
                tokenRepository: tokenRepo,
                transitionState,
                messagingPort: telegramAdapter,
                tokenEncryption,
              })
            : null;

        // Thick worker (ADR-005): FSM → NLP → user response
        const messageWorker = createMessageWorker({
          redis,
          logger: rootLogger,
          // @ts-expect-error TODO: implement RegisterExpenseUseCase wiring
          registerExpense: null,
          getConversationState,
          transitionState,
          recoverCorruptedState,
          userRepo,
          messagingAdapters: {
            telegram: telegramAdapter,
            // TODO: replace with real WhatsApp adapter when implemented
            whatsapp: telegramAdapter,
          },
          initiateCloudConnection,
          cancelCloudConnection,
          handleSpreadsheetFileSelection,
        });
        app.log.info(
          `Started process-message worker (concurrency: ${messageWorker.opts.concurrency})`,
        );

        registerTelegramWebhook(app, {
          webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
          incomingMessageQueue,
          handleStartCommand,
          resolveIdentity,
        });

        // Auto-register Telegram webhook on startup so Telegram knows where to deliver updates
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
          app.log.warn(
            'WEBHOOK_BASE_URL is localhost — Telegram webhook auto-registration skipped',
          );
        }

        if (handleOAuthCallback !== null) {
          registerOAuthCallback(app, { handleOAuthCallback });
        }

        if (sendOAuthReminder !== null) {
          const oauthReminderWorker = createOAuthReminderWorker({
            redis,
            logger: rootLogger,
            sendOAuthReminder,
            redirectUri: env.GOOGLE_REDIRECT_URI,
          });
          app.log.info(
            `Started oauth-reminder worker (concurrency: ${oauthReminderWorker.opts.concurrency})`,
          );
        }

        // Session timeout worker — periodic job that transitions expired states to IDLE
        try {
          const sessionTimeoutQueue = new Queue('session-timeout', {
            connection: redis,
          });
          await sessionTimeoutQueue.add('session-timeout', {}, { repeat: { every: 60000 } });

          const handleExpiredSessions = new HandleExpiredSessions(
            conversationRepo,
            userRepo,
            transitionState,
            telegramAdapter,
            rootLogger,
          );

          createSessionTimeoutWorker({
            redis,
            handleExpiredSessions,
            logger: rootLogger,
          });
          app.log.info('Started session-timeout worker (repeat every 60s)');
        } catch (err) {
          app.log.error({ msg: 'Failed to start session-timeout worker', error: err });
        }
      }
    } catch (err) {
      app.log.error({ msg: 'Failed to initialize infrastructure', error: err });
    }
  }

  // -- Arranque ---------------------------------------------------------------
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Gastto listening on port ${env.PORT}`);
}

bootstrap().catch((err) => {
  const logger = createLogger({ level: 'info', pretty: false });
  logger.fatal(err, 'Fatal error during bootstrap');
  process.exit(1);
});
