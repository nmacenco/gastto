// LAYER: Interfaces
// Fastify handler for Telegram webhook.
// Responsibilities (ADR-005, Stage 1):
//   1. Validates origin (secret token in header)
//   2. Parses payload
//   3. Resolves user identity (with Redis cache)
//   4. Enqueues BullMQ job
//   5. Sends acknowledgment < 300ms
//   6. Returns HTTP 200

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Queue } from "bullmq";
import { z } from "zod";
import type { ResolveUserIdentityUseCase } from "../../application/use-cases/user/ResolveUserIdentity";
import type { MessagingPort } from "../../domain/ports/services";

// Minimal Telegram payload schema (only the fields we need)
const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      from: z.object({ id: z.number() }).optional(),
      chat: z.object({ id: z.number() }),
      text: z.string().optional(),
      date: z.number(),
    })
    .optional(),
});

export type ProcessMessageJobData = {
  userId: string;
  rawMessage: string;
  channel: "telegram" | "whatsapp";
  externalId: string;
  receivedAt: string;
};

export function registerTelegramWebhook(
  app: FastifyInstance,
  opts: {
    webhookSecret: string;
    messageQueue: Queue<ProcessMessageJobData>;
    resolveIdentity: ResolveUserIdentityUseCase;
    telegramMessaging: MessagingPort;
  },
): void {
  app.post(
    "/webhook/telegram",
    async (req: FastifyRequest, reply: FastifyReply) => {
      // ── Stage 1: Origin validation (ADR-005) ──────────────────────────────
      const token = req.headers["x-telegram-bot-api-secret-token"];
      if (token !== opts.webhookSecret) {
        req.log.warn(
          { ip: req.ip },
          "Rejected Telegram webhook: invalid token",
        );
        return reply.status(403).send({ error: "Forbidden" });
      }

      // ── Etapa 2: Parseo defensivo del payload ────────────────────────────────
      const parseResult = TelegramUpdateSchema.safeParse(req.body);
      if (!parseResult.success || !parseResult.data.message) {
        // Responde 200 siempre para evitar reintentos infinitos de Telegram (HU-0.02)
        req.log.warn(
          { body: req.body, errors: parseResult.error },
          "Unparseable Telegram payload",
        );
        return reply.status(200).send({ ok: true });
      }

      const { message } = parseResult.data;
      const externalId = String(message.chat.id);
      const rawMessage = message.text ?? "";

      // Tipo no soportado: audio, foto, sticker, etc. (HU-0.02, Escenario 2)
      if (!message.text) {
        await opts.telegramMessaging.sendMessage(
          externalId,
          "Por ahora solo proceso mensajes de texto. Contame tu gasto escribiéndolo.",
        );
        return reply.status(200).send({ ok: true });
      }

      // ── Stage 3: Identity resolution (with Redis cache, ADR-008) ──────────
      const { userId } = await opts.resolveIdentity.execute({
        channel: "telegram",
        externalId,
      });

      // ── Etapa 4: Encolado en BullMQ ──────────────────────────────────────────
      await opts.messageQueue.add("process-message", {
        userId,
        rawMessage,
        channel: "telegram",
        externalId,
        receivedAt: new Date().toISOString(),
      });

      // ── Etapa 5: Acuse de recibo < 300ms (E1-US-02) ──────────────────────────
      // Se envía en paralelo al encolado; no bloquea la respuesta HTTP
      opts.telegramMessaging
        .sendMessage(externalId, "Recibido, procesando tu gasto…")
        .catch((err) =>
          req.log.error({ err, externalId }, "Failed to send ack"),
        );

      // ── Etapa 6: HTTP 200 a Telegram ─────────────────────────────────────────
      return reply.status(200).send({ ok: true });
    },
  );
}
