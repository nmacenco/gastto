// LAYER: Interfaces
// Application entry point. Assembles all layers following
// the dependency inversion principle: Domain ← Application ← Infrastructure ← Interfaces.
// A single persistent process starts Fastify + BullMQ workers (ADR-009).

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

// Application
import { ResolveUserIdentityUseCase } from './application/use-cases/user/ResolveUserIdentity';
// Interfaces
import { registerTelegramWebhook } from './interfaces/http/routes/telegram.webhook';

async function bootstrap(): Promise<void> {
  // ── Sentry: inicializar antes que todo (ADR — observabilidad) ──────────────
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
    });
  }

  // ── Fastify ───────────────────────────────────────────────────────────────
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

  // ── Infraestructura condicional (solo cuando las env vars están presentes) ─
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

    const messageQueue = new Queue<{
      userId: string;
      rawMessage: string;
      channel: 'telegram' | 'whatsapp';
      externalId: string;
      receivedAt: string;
    }>('process-message', {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });

    if (env.TELEGRAM_WEBHOOK_SECRET) {
      registerTelegramWebhook(app, {
        webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
        messageQueue,
        resolveIdentity,
        // @ts-expect-error TODO: inject TelegramAdapter when implemented
        telegramMessaging: null,
      });
    }
  }

  // ── Arranque ──────────────────────────────────────────────────────────────
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Gastto listening on port ${env.PORT}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
