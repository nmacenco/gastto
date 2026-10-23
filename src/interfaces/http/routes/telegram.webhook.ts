// LAYER: Interfaces
// Fastify handler for Telegram webhook.
// Responsibilities (ADR-005, Stage 2; ADR-011):
//   1. Origin validation is handled by preHandler middleware (telegramAuth.ts)
//   2. Parses raw payload via TelegramPayloadParser (Infrastructure)
//   3. Detects /start command and delegates to HandleStartCommand use case
//   4. For MALFORMED payloads: logs structured error and returns 200 (prevents retry loops)
//   5. For all other messages: enqueues to incoming-message queue (thin FIFO worker)
//   6. Always returns HTTP 200 to avoid Telegram retry loops

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import type { HandleStartCommand } from '../../../application/use-cases/conversation/HandleStartCommand';
import type { SendImmediateAcknowledgement } from '../../../application/use-cases/conversation/SendImmediateAcknowledgement';
import type { ResolveUserIdentityUseCase } from '../../../application/use-cases/user/ResolveUserIdentity';
import type { IncomingMessageJobData } from '../../../application/ports/IncomingMessageJob';
import {
  getTelegramChatScope,
  parseTelegramPayload,
} from '../../../infrastructure/adapters/telegram/TelegramPayloadParser';
import { validateTelegramOrigin } from '../middleware/telegramAuth';

export interface TelegramWebhookHandlerDeps {
  incomingMessageQueue: Queue<IncomingMessageJobData>;
  handleStartCommand: HandleStartCommand;
  sendImmediateAcknowledgement: SendImmediateAcknowledgement;
  resolveIdentity: ResolveUserIdentityUseCase;
}

export interface TelegramWebhookDeps extends TelegramWebhookHandlerDeps {
  webhookSecret: string;
}

export async function handleTelegramWebhook(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: TelegramWebhookHandlerDeps,
): Promise<void> {
  // Telegram group and channel updates are acknowledged after origin validation,
  // but must never create an identity or trigger downstream side effects.
  if (getTelegramChatScope(req.body) !== 'private') {
    return reply.status(200).send({ ok: true });
  }

  const payload = parseTelegramPayload(req.body);

  // Malformed payload short-circuit (owned by route layer since ADR-011)
  if (payload.messageType === 'MALFORMED') {
    req.log.error({
      endpoint: '/webhook/telegram',
      code: 'MALFORMED_PAYLOAD',
    });
    return reply.status(200).send({ ok: true });
  }

  // /start command short-circuit
  if (payload.messageType === 'TEXT' && payload.text?.toLowerCase() === '/start') {
    const rawBody = req.body as Record<string, unknown>;
    const message = rawBody?.message as Record<string, unknown> | undefined;
    const from = message?.from as Record<string, unknown> | undefined;
    const username = typeof from?.username === 'string' ? from.username : undefined;

    const { userId } = await deps.resolveIdentity.execute({
      channel: payload.channel,
      externalId: payload.chatId,
    });

    await deps.handleStartCommand.execute({ userId, chatId: payload.chatId, username });
    return reply.status(200).send({ ok: true });
  }

  // Send immediate acknowledgment for text payloads (fire-and-forget) so the
  // user sees a response within <= 1 second even if downstream workers are busy.
  if (payload.messageType === 'TEXT') {
    deps.sendImmediateAcknowledgement
      .execute({
        chatId: payload.chatId,
        channel: payload.channel,
        userId: payload.userId,
      })
      .then((result) => {
        if (result.status === 'failure') {
          req.log.error({
            endpoint: '/webhook/telegram',
            code: 'ACK_SEND_FAILED',
            chatId: payload.chatId,
            errorCode: result.errorCode,
          });
        }
      })
      .catch((err: Error) =>
        req.log.error({
          endpoint: '/webhook/telegram',
          code: 'ACK_SEND_FAILED',
          chatId: payload.chatId,
          error: err.message,
        }),
      );
  }

  // Enqueue everything else to the thin FIFO worker (ADR-011).
  // MALFORMED payloads are already short-circuited, so externalMessageId is always defined here.
  await deps.incomingMessageQueue.add('incoming-message', {
    messageType: payload.messageType,
    chatId: payload.chatId,
    userId: payload.userId,
    text: payload.text,
    callbackData: payload.callbackData,
    timestamp: payload.timestamp.toISOString(),
    channel: payload.channel,
    externalMessageId: payload.externalMessageId!,
    rawPayload: payload.rawPayload,
  });

  return reply.status(200).send({ ok: true });
}

const TelegramWebhookBodySchema = z
  .object({
    update_id: z.number().optional(),
    message: z
      .object({
        message_id: z.number().optional(),
        chat: z.object({ id: z.number() }).passthrough().optional(),
        from: z
          .object({ id: z.number(), username: z.string().optional() })
          .passthrough()
          .optional(),
        text: z.string().optional(),
        date: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .describe('Telegram Update payload (simplified schema for documentation)');

export function registerTelegramWebhook(app: FastifyInstance, opts: TelegramWebhookDeps): void {
  app.post('/webhook/telegram', {
    schema: {
      tags: ['Webhooks'],
      description:
        'Receives Telegram bot updates. Requires the X-Telegram-Bot-Api-Secret-Token header.',
      headers: z.object({
        'x-telegram-bot-api-secret-token': z.string().describe('Webhook secret token'),
      }),
      body: TelegramWebhookBodySchema,
      response: {
        200: z.object({ ok: z.literal(true) }),
      },
    },
    onRequest: [validateTelegramOrigin(opts.webhookSecret)],
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      await handleTelegramWebhook(req, reply, opts);
    },
  });
}
