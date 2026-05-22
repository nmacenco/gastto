// LAYER: Interfaces
// Application entry point. Assembles all layers following
// the dependency inversion principle: Domain <- Application <- Infrastructure <- Interfaces.
// A single persistent process starts Fastify + BullMQ workers (ADR-009, ADR-010).

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as Sentry from '@sentry/node';

import { env } from '@config/env';

// Infrastructure
import { DrizzleUserRepository } from './infrastructure/db/repositories/DrizzleUserRepository';
import { TelegramMessengerAdapter } from './infrastructure/adapters/telegram/TelegramMessengerAdapter';

// Application
import { ResolveUserIdentityUseCase } from './application/use-cases/user/ResolveUserIdentity';
import { HandleStartCommand } from './application/use-cases/conversation/HandleStartCommand';
import { HandleUnsupportedMessage } from './application/use-cases/conversation/HandleUnsupportedMessage';
import { RouteIncomingMessage } from './application/use-cases/conversation/RouteIncomingMessage';
import type { ProcessMessageJobData } from './application/ports/ProcessMessageJob';
import type { IncomingMessageJobData } from './application/ports/IncomingMessageJob';

// Interfaces
import { registerTelegramWebhook } from './interfaces/http/routes/telegram.webhook';
import { createIncomingMessageWorker } from './interfaces/workers/incomingMessage.worker';
import { createMessageWorker } from './interfaces/workers/message.worker';

async function bootstrap(): Promise<void> {
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

  // Wire Sentry into Fastify error handling
  const previousErrorHandler = app.errorHandler;
  app.setErrorHandler((error, request, reply) => {
    Sentry.captureException(error);
    return previousErrorHandler(error, request, reply);
  });

  // Health check para Fly.io
  app.get('/health', () => ({
    status: 'ok',
    ts: new Date().toISOString(),
  }));

  // -- Infraestructura condicional (solo cuando las env vars estan presentes) --
  if (env.DATABASE_URL && env.REDIS_URL) {
    const sql = postgres(env.DATABASE_URL);
    const db = drizzle(sql);
    const redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });

    // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
    const userRepo = new DrizzleUserRepository(db, redis);

    const resolveIdentity = new ResolveUserIdentityUseCase(
      userRepo,
      // @ts-expect-error TODO: inject DrizzleConversationStateRepository when implemented
      null,
    );

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
      const telegramAdapter = new TelegramMessengerAdapter(env.TELEGRAM_BOT_TOKEN);
      const handleStartCommand = new HandleStartCommand(telegramAdapter);
      const handleUnsupportedMessage = new HandleUnsupportedMessage(telegramAdapter);
      const routeIncomingMessage = new RouteIncomingMessage({
        messageQueue,
        resolveIdentity,
        messagingPort: telegramAdapter,
        handleUnsupportedMessage,
      });

      // Thin FIFO worker (ADR-010): guarantees per-user message ordering
      const incomingMessageWorker = createIncomingMessageWorker({
        redis,
        routeIncomingMessage,
      });
      app.log.info(
        `Started incoming-message worker (concurrency: ${incomingMessageWorker.opts.concurrency})`,
      );

      // Thick worker (ADR-005): FSM → NLP → user response
      const messageWorker = createMessageWorker({
        redis,
        // @ts-expect-error TODO: implement RegisterExpenseUseCase wiring
        registerExpense: null,
        // @ts-expect-error TODO: implement IConversationStateRepository wiring
        conversationRepo: null,
        userRepo,
        messagingAdapters: {
          telegram: telegramAdapter,
          // TODO: replace with real WhatsApp adapter when implemented
          whatsapp: telegramAdapter,
        },
      });
      app.log.info(
        `Started process-message worker (concurrency: ${messageWorker.opts.concurrency})`,
      );

      registerTelegramWebhook(app, {
        webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
        incomingMessageQueue,
        handleStartCommand,
      });
    }
  }

  // -- Arranque ---------------------------------------------------------------
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Gastto listening on port ${env.PORT}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
