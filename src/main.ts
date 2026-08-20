// LAYER: Interfaces
// Application entry point. Assembles all layers following
// the dependency inversion principle: Domain <- Application <- Infrastructure <- Interfaces.
// A single persistent process starts Fastify + BullMQ workers (ADR-009, ADR-011).

import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as Sentry from '@sentry/node';

import { env } from '@config/env';
import type { Env } from '@config/env.schema';
import { createLogger } from './infrastructure/logger';
import type { CreateLoggerOptions } from './infrastructure/logger';
import type { Logger } from 'pino';
import { scrubSentryEvent } from './infrastructure/observability/sensitiveData';

import { createFastify, buildDependencies, registerRoutes, registerWorkers } from './bootstrap';

/** Logger factory injected into bootstrap for testability. */
export type LoggerFactory = (opts?: CreateLoggerOptions) => Logger;

type ShutdownSignal = 'SIGTERM' | 'SIGINT';
type ShutdownTarget = Pick<FastifyInstance, 'close' | 'log'>;
interface SignalSource {
  once(signal: ShutdownSignal, listener: () => void): unknown;
}

/** Installs process signal handlers and returns the shared idempotent shutdown operation. */
export function registerShutdownHandlers(
  app: ShutdownTarget,
  signalSource: SignalSource = process,
): (signal: ShutdownSignal) => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (signal: ShutdownSignal): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    app.log.info({ msg: 'Graceful shutdown started', signal });
    shutdownPromise = app.close().catch((error: unknown) => {
      app.log.error({
        msg: 'Graceful shutdown failed',
        endpoint: 'process',
        code: 'GRACEFUL_SHUTDOWN_FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return shutdownPromise;
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    signalSource.once(signal, () => {
      void shutdown(signal);
    });
  }

  return shutdown;
}

export type RegisterShutdownHandlers = typeof registerShutdownHandlers;

/**
 * Bootstraps the Gastto server.
 *
 * Accepts `env` and a logger factory so tests can start the server without
 * touching `process.env` or the real logger implementation.
 */
export async function bootstrap(
  env: Env,
  loggerFactory: LoggerFactory = createLogger,
): Promise<FastifyInstance> {
  // -- Structured logger (ADR-013) ---------------------------------------------
  const rootLogger = loggerFactory({
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV !== 'production',
  });

  // -- Sentry: inicializar antes que todo (ADR -- observabilidad) -------------
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      beforeSend: scrubSentryEvent,
    });
  }

  // -- Fastify ----------------------------------------------------------------
  const app = await createFastify(env, rootLogger);

  // -- Infraestructura condicional (solo cuando las env vars estan presentes) --
  let deps: ReturnType<typeof buildDependencies> | null = null;
  if (env.DATABASE_URL && env.REDIS_URL) {
    let sql: ReturnType<typeof postgres> | null = null;
    let redis: Redis | null = null;
    try {
      sql = postgres(env.DATABASE_URL);
      const db = drizzle(sql);
      redis = new Redis(env.REDIS_URL, {
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

      deps = buildDependencies(env, { db, redis, rootLogger });
      await registerWorkers(app, deps, env);

      const runtimeSql = sql;
      const runtimeRedis = redis;
      app.addHook('onClose', async () => {
        const results = await Promise.allSettled([runtimeRedis.quit(), runtimeSql.end()]);
        const failure = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        if (failure) {
          throw failure.reason;
        }
      });
    } catch (err) {
      await Promise.allSettled([redis?.quit(), sql?.end()]);
      app.log.error({ msg: 'Failed to initialize infrastructure', error: err });
    }
  }

  registerRoutes(app, deps, env);

  // -- Arranque ---------------------------------------------------------------
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Gastto listening on port ${env.PORT}`);

  return app;
}

// Only auto-start when this file is the process entry point so tests can import
// `bootstrap` without launching the server.
const isMainModule = typeof require !== 'undefined' && require.main === module;
if (isMainModule) {
  bootstrap(env, createLogger)
    .then((app) => {
      registerShutdownHandlers(app);
    })
    .catch((err) => {
      const logger = createLogger({ level: 'info', pretty: false });
      logger.fatal(err, 'Fatal error during bootstrap');
      process.exit(1);
    });
}
