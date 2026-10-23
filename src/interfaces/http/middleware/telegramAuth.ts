// LAYER: Interfaces
// Fastify preHandler hook that validates Telegram webhook origin.
// Rejects any request without the expected X-Telegram-Bot-Api-Secret-Token
// header with HTTP 403. The secret is read from environment variables.

import type { FastifyRequest, FastifyReply, onRequestAsyncHookHandler } from 'fastify';

export function validateTelegramOrigin(secret: string): onRequestAsyncHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = req.headers['x-telegram-bot-api-secret-token'];
    if (token !== secret) {
      req.log.warn({ ip: req.ip }, 'Rejected Telegram webhook: invalid token');
      await reply.status(403).send({ error: 'Forbidden' });
    }
  };
}
