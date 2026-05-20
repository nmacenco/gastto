// LAYER: Interfaces
// Fastify handler for Telegram webhook.
// Responsibilities (ADR-005, Stage 1):
//   1. Origin validation is handled by preHandler middleware (telegramAuth.ts)
//   2. Parses payload
//   3. Detects /start command and delegates to HandleStartCommand use case
//   4. For all other messages: resolves user identity, enqueues BullMQ job,
//      sends acknowledgment < 300ms, returns HTTP 200

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import type { ResolveUserIdentityUseCase } from '../../../application/use-cases/user/ResolveUserIdentity';
import type { HandleStartCommand } from '../../../application/use-cases/conversation/HandleStartCommand';
import type { MessagingPort } from '../../../domain/ports/services';
import { validateTelegramOrigin } from '../middleware/telegramAuth';

// Minimal Telegram payload schema (only the fields we need)
const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      from: z.object({ id: z.number(), username: z.string().optional() }).optional(),
      chat: z.object({ id: z.number() }),
      text: z.string().optional(),
      date: z.number(),
    })
    .optional(),
});

export type ProcessMessageJobData = {
  userId: string;
  rawMessage: string;
  channel: 'telegram' | 'whatsapp';
  externalId: string;
  receivedAt: string;
};

export interface TelegramWebhookHandlerDeps {
  messageQueue: Queue<ProcessMessageJobData>;
  resolveIdentity: ResolveUserIdentityUseCase;
  telegramMessaging: MessagingPort;
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
  // ── Stage 2: Defensive payload parsing ──────────────────────────────
  const parseResult = TelegramUpdateSchema.safeParse(req.body);
  if (!parseResult.success || !parseResult.data.message) {
    // Always respond 200 to avoid infinite Telegram retries (HU-0.02)
    req.log.warn({ body: req.body, errors: parseResult.error }, 'Unparseable Telegram payload');
    return reply.status(200).send({ ok: true });
  }

  const { message } = parseResult.data;
  const externalId = String(message.chat.id);
  const rawMessage = message.text ?? '';

  // Unsupported type: audio, photo, sticker, etc. (HU-0.02, Scenario 2)
  if (!message.text) {
    await deps.telegramMessaging.sendMessage(
      externalId,
      'Por ahora solo proceso mensajes de texto. Contame tu gasto escribiendolo.',
    );
    return reply.status(200).send({ ok: true });
  }

  // ── Stage 3: /start command short-circuit ───────────────────────────
  if (rawMessage.trim().toLowerCase() === '/start') {
    const username = message.from?.username;
    await deps.handleStartCommand.execute({ chatId: externalId, username });
    return reply.status(200).send({ ok: true });
  }

  // ── Stage 4: Identity resolution (with Redis cache, ADR-008) ──────────
  const { userId } = await deps.resolveIdentity.execute({
    channel: 'telegram',
    externalId,
  });

  // ── Stage 5: BullMQ enqueue ─────────────────────────────────────────
  await deps.messageQueue.add('process-message', {
    userId,
    rawMessage,
    channel: 'telegram',
    externalId,
    receivedAt: new Date().toISOString(),
  });

  // ── Stage 6: Ack < 300ms (E1-US-02) ───────────────────────────────────
  // Sent in parallel to enqueue; does not block HTTP response
  deps.telegramMessaging
    .sendMessage(externalId, 'Recibido, procesando tu gasto…')
    .catch((err: Error) => req.log.error({ err, externalId }, 'Failed to send ack'));

  // ── Stage 7: HTTP 200 to Telegram ─────────────────────────────────────
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
