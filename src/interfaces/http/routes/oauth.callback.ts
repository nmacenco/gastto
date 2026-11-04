// LAYER: Interfaces
// Fastify route handlers for OAuth provider callbacks.
// Responsibilities:
//   1. Parse and validate query params via Zod (fastify-type-provider-zod)
//   2. Delegate to HandleOAuthCallback use case
//   3. Return a simple HTML page to the browser

import type { FastifyInstance, FastifyReply, onRequestAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { HandleOAuthCallback } from '../../../application/use-cases/spreadsheet/HandleOAuthCallback';

export interface OAuthCallbackDeps {
  handleOAuthCallback: HandleOAuthCallback;
  admission?: onRequestAsyncHookHandler;
}

const OAuthCallbackQuerySchema = z
  .object({
    code: z.string().min(1).optional().describe('Authorization code returned by the provider'),
    error: z.string().min(1).optional().describe('Provider denial code'),
    state: z.string().min(1).describe('CSRF state parameter'),
  })
  .refine((query) => (query.code === undefined) !== (query.error === undefined), {
    message: 'Exactly one of code or error is required',
  });

async function handleOAuthCallback(
  req: { query: z.infer<typeof OAuthCallbackQuerySchema> },
  reply: FastifyReply,
  deps: OAuthCallbackDeps,
  provider: 'google' | 'microsoft',
): Promise<void> {
  const { code, error, state } = req.query;
  const result = await deps.handleOAuthCallback.execute(
    code !== undefined ? { code, state, provider } : { error: error!, state, provider },
  );

  const body = result.success ? 'You can close this window' : escapeHtml(result.message);
  const html = `<html><head><meta charset="utf-8"></head><body>${body}</body></html>`;

  return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(html);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

export function registerOAuthCallback(app: FastifyInstance, deps: OAuthCallbackDeps): void {
  const admitCallback: onRequestAsyncHookHandler = async function (req, reply) {
    reply.header('cache-control', 'no-store');
    if (deps.admission) await deps.admission.call(this, req, reply);
  };
  app.withTypeProvider<ZodTypeProvider>().get(
    '/auth/google/callback',
    {
      onRequest: admitCallback,
      schema: {
        tags: ['Auth'],
        description: 'Receives the Google OAuth callback after user authorizes the application.',
        querystring: OAuthCallbackQuerySchema,
        response: {
          200: z.string().describe('Simple HTML page for the browser'),
          429: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => handleOAuthCallback(req, reply, deps, 'google'),
  );

  app.withTypeProvider<ZodTypeProvider>().get(
    '/auth/microsoft/callback',
    {
      onRequest: admitCallback,
      schema: {
        tags: ['Auth'],
        description: 'Receives the Microsoft OAuth callback after user authorizes the application.',
        querystring: OAuthCallbackQuerySchema,
        response: {
          200: z.string().describe('Simple HTML page for the browser'),
          429: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => handleOAuthCallback(req, reply, deps, 'microsoft'),
  );
}
