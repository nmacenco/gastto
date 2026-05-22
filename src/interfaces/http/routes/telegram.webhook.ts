// LAYER: Interfaces
// Fastify handler for Telegram webhook.
// Responsibilities (ADR-005, Stage 2):
//   1. Origin validation is handled by preHandler middleware (telegramAuth.ts)
//   2. Parses raw payload via TelegramPayloadParser (Infrastructure)
//   3. Detects /start command and delegates to HandleStartCommand use case
//   4. For all other messages: delegates to RouteIncomingMessage use case
//   5. Always returns HTTP 200 to avoid Telegram retry loops

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteIncomingMessage } from '../../../application/use-cases/conversation/RouteIncomingMessage';
import type { HandleStartCommand } from '../../../application/use-cases/conversation/HandleStartCommand';
import { parseTelegramPayload } from '../../../infrastructure/adapters/telegram/TelegramPayloadParser';
import { validateTelegramOrigin } from '../middleware/telegramAuth';

export interface TelegramWebhookHandlerDeps {
  routeIncomingMessage: RouteIncomingMessage;
  handleStartCommand: HandleStartCommand;
}

export interface TelegramWebhookDeps extends TelegramWebhookHandlerDeps {
  webhookSecret: string;
}

export async function handleTelegramWebhook(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: TelegramWebhookHandlerDeps,
): Promise<void> {
  const payload = parseTelegramPayload(req.body);

  // /start command short-circuit
  if (payload.messageType === 'TEXT' && payload.text?.toLowerCase() === '/start') {
    const rawBody = req.body as Record<string, unknown>;
    const message = rawBody?.message as Record<string, unknown> | undefined;
    const from = message?.from as Record<string, unknown> | undefined;
    const username = typeof from?.username === 'string' ? from.username : undefined;

    await deps.handleStartCommand.execute({ chatId: payload.chatId, username });
    return reply.status(200).send({ ok: true });
  }

  await deps.routeIncomingMessage.execute(payload);
  return reply.status(200).send({ ok: true });
}

export function registerTelegramWebhook(app: FastifyInstance, opts: TelegramWebhookDeps): void {
  app.post('/webhook/telegram', {
    preHandler: [validateTelegramOrigin(opts.webhookSecret)],
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      await handleTelegramWebhook(req, reply, opts);
    },
  });
}
