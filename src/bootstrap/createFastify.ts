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
import { pinoRedaction } from '../infrastructure/observability/sensitiveData';

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

  // Prevent request logs from being lost when the server shuts down unexpectedly
  app.addHook('onClose', () => {
    rootLogger.debug('Fastify instance closing');
  });

  return app;
}
