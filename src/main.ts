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
import { OpenAIAdapter } from './infrastructure/adapters/llm/OpenAIAdapter';
// import { ClaudeAdapter } from './infrastructure/adapters/llm/ClaudeAdapter'; // alternativa ADR-002

// Application
import { ResolveUserIdentityUseCase } from './application/use-cases/user/ResolveUserIdentity';
import { RegisterExpenseUseCase } from './application/use-cases/expense/RegisterExpense';

// Interfaces
import { registerTelegramWebhook } from './interfaces/http/routes/telegram.webhook';
import { createMessageWorker } from './interfaces/workers/message.worker';

async function bootstrap(): Promise<void> {
  // ── Sentry: inicializar antes que todo (ADR — observabilidad) ──────────────
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
    });
  }

  // ── Infraestructura: conexiones ───────────────────────────────────────────
  const sql = postgres(env.DATABASE_URL);
  const db = drizzle(sql);
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  // ── Infraestructura: repos ────────────────────────────────────────────────
  const userRepo = new DrizzleUserRepository(db as any, redis);

  // ── Infraestructura: adapters de servicio ─────────────────────────────────
  const llmAdapter = new OpenAIAdapter(env.OPENAI_API_KEY);
  // Para usar Claude en su lugar: new ClaudeAdapter(env.ANTHROPIC_API_KEY!)

  // ── Application: casos de uso ──────────────────────────────────────────────
  // NOTE: in production use an IoC container (tsyringe, awilix).
  // For the boilerplate, explicit manual wiring.
  const resolveIdentity = new ResolveUserIdentityUseCase(
    userRepo,
    null as any, // TODO: DrizzleConversationStateRepository
  );

  // ── BullMQ: cola de mensajes ──────────────────────────────────────────────
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

  // Health check para Fly.io
  app.get('/health', async () => ({
    status: 'ok',
    ts: new Date().toISOString(),
  }));

  // Webhook Telegram (entire stack should be available here)
  registerTelegramWebhook(app, {
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    messageQueue,
    resolveIdentity,
    telegramMessaging: null as any, // TODO: TelegramAdapter implements MessagingPort
  });

  // ── Workers BullMQ (mismo proceso, ADR-009) ───────────────────────────────
  // createMessageWorker({ redis, registerExpense, conversationRepo, userRepo, messagingAdapters });

  // ── Arranque ──────────────────────────────────────────────────────────────
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Gastto listening on port ${env.PORT}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
