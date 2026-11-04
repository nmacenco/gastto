// LAYER: Bootstrap
// Fastify factory: plugins, Zod compilers, Swagger and Sentry error handling.

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import * as Sentry from '@sentry/node';
import type { Logger } from 'pino';

import type { Env } from '../config/env.schema';
import {
  pinoRedaction,
  scrubLogObject,
  pinoHooks,
} from '../infrastructure/observability/sensitiveData';

/**
 * Creates and configures a Fastify instance with the standard plugin stack.
 *
 * Registers helmet, sensible, swagger, swagger-ui, and the Zod type provider.
 * Wires Sentry into the error handler when `SENTRY_DSN` is present.
 */
export async function createFastify(env: Env, rootLogger: Logger): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: pinoRedaction,
      hooks: pinoHooks,
      formatters: { log: scrubLogObject },
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

  if (env.NODE_ENV !== 'production') {
    await app.register(fastifySwaggerUi, { routePrefix: '/documentation' });
  }

  // Wire Sentry into Fastify error handling
  const previousErrorHandler = app.errorHandler;
  app.setErrorHandler((error, request, reply) => {
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;
    if (!Number.isFinite(status) || status >= 500) {
      try {
        Sentry.captureException(new Error('HTTP_UNEXPECTED_ERROR'));
      } catch {
        request.log.warn({ msg: 'Error reporting unavailable', code: 'TELEMETRY_UNAVAILABLE' });
      }
      request.log.error({
        msg: 'Unexpected HTTP failure',
        endpoint: request.routeOptions.url,
        code: 'HTTP_UNEXPECTED_ERROR',
      });
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
    return previousErrorHandler(error, request, reply);
  });

  // Prevent request logs from being lost when the server shuts down unexpectedly
  app.addHook('onClose', () => {
    rootLogger.debug('Fastify instance closing');
  });

  return app;
}
