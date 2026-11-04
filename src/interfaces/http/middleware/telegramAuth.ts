// LAYER: Interfaces
// Fastify onRequest hook that validates Telegram webhook origin.
// Rejects any request without the expected X-Telegram-Bot-Api-Secret-Token
// header with HTTP 403. The secret is read from environment variables.

import type { FastifyRequest, FastifyReply, onRequestAsyncHookHandler } from 'fastify';

export function validateTelegramOrigin(
  secret: string,
  admission?: onRequestAsyncHookHandler,
): onRequestAsyncHookHandler {
  let lastRejection = 0;
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.headers['x-telegram-bot-api-secret-token'];
    if (token !== secret) {
      if (Date.now() - lastRejection >= 10_000) {
        req.log.warn({
          msg: 'Rejected Telegram origin',
          endpoint: '/webhook/telegram',
          code: 'TELEGRAM_ORIGIN_REJECTED',
        });
        lastRejection = Date.now();
      }
      if (admission) await admission.call(this, req, reply);
      if (reply.sent) return;
      await reply.status(403).send({ error: 'Forbidden' });
    }
  };
}
