// LAYER: Interfaces
// Fastify route handlers for OAuth provider callbacks.
// Responsibilities:
//   1. Parse and validate query params via Zod (fastify-type-provider-zod)
//   2. Delegate to HandleOAuthCallback use case
//   3. Return a simple HTML page to the browser

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { HandleOAuthCallback } from '../../../application/use-cases/spreadsheet/HandleOAuthCallback';

export interface OAuthCallbackDeps {
  handleOAuthCallback: HandleOAuthCallback;
}

const OAuthCallbackQuerySchema = z.object({
  code: z.string().describe('Authorization code returned by the provider'),
  state: z.string().describe('CSRF state parameter'),
});

async function handleOAuthCallback(
  req: { query: { code: string; state: string } },
  reply: FastifyReply,
  deps: OAuthCallbackDeps,
): Promise<void> {
  const { code, state } = req.query;
  const result = await deps.handleOAuthCallback.execute({ code, state });

  const html = result.success
    ? '<html><body>You can close this window</body></html>'
    : `<html><body>${result.message}</body></html>`;

  return reply.type('text/html').send(html);
}

export function registerOAuthCallback(app: FastifyInstance, deps: OAuthCallbackDeps): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/auth/google/callback',
    {
      schema: {
        tags: ['Auth'],
        description: 'Receives the Google OAuth callback after user authorizes the application.',
        querystring: OAuthCallbackQuerySchema,
        response: {
          200: z.string().describe('Simple HTML page for the browser'),
        },
      },
    },
    async (req, reply) => handleOAuthCallback(req, reply, deps),
  );

  app.withTypeProvider<ZodTypeProvider>().get(
    '/auth/microsoft/callback',
    {
      schema: {
        tags: ['Auth'],
        description: 'Receives the Microsoft OAuth callback after user authorizes the application.',
        querystring: OAuthCallbackQuerySchema,
        response: {
          200: z.string().describe('Simple HTML page for the browser'),
        },
      },
    },
    async (req, reply) => handleOAuthCallback(req, reply, deps),
  );
}
