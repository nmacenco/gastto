// LAYER: Bootstrap
// Registers HTTP routes on the Fastify instance.

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { Env } from '../config/env.schema';
import type { Dependencies } from './types';
import { registerTelegramWebhook } from '../interfaces/http/routes/telegram.webhook';
import { registerOAuthCallback } from '../interfaces/http/routes/oauth.callback';

/**
 * Registers application routes:
 * - `/health` — always available
 * - `/webhook/telegram` — when Telegram is configured
 * - `/auth/google/callback` and `/auth/microsoft/callback` — when Google OAuth is configured
 *
 * `deps` may be `null` when the application starts without database or Redis,
 * in which case only the health route is registered.
 */
export function registerRoutes(
  app: FastifyInstance,
  deps: Dependencies | null,
  env: Env,
): void {
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

  if (deps?.telegram !== null && deps?.telegram !== undefined) {
    registerTelegramWebhook(app, {
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
      incomingMessageQueue: deps.incomingMessageQueue,
      handleStartCommand: deps.telegram.handleStartCommand,
      sendImmediateAcknowledgement: deps.telegram.sendImmediateAcknowledgement,
      resolveIdentity: deps.resolveIdentity,
    });
  }

  if (deps?.googleOAuth !== null && deps?.googleOAuth !== undefined) {
    registerOAuthCallback(app, { handleOAuthCallback: deps.googleOAuth.handleOAuthCallback });
  }
}
