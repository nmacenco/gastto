// LAYER: Interfaces
// BullMQ worker — Stage 1.5 of the async pipeline.
// Consumes `incoming-message` jobs in the same persistent process as Fastify.
// Responsibilities: guarantee FIFO per user by running with concurrency: 1,
// deserialize job data back to NormalizedPayload, and delegate to
// RouteIncomingMessage use case.

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { RouteIncomingMessage } from '../../application/use-cases/conversation/RouteIncomingMessage';
import {
  IncomingMessageJobDataSchema,
  type IncomingMessageJobData,
} from '../../application/ports/IncomingMessageJob';
import { InvalidJobPayloadError } from '../../application/ports/InvalidJobPayloadError';
import type { NormalizedPayload } from '../../domain/ports/messaging';

export async function processIncomingMessageJob(
  job: Job<IncomingMessageJobData>,
  routeIncomingMessage: RouteIncomingMessage,
): Promise<void> {
  const parsed = IncomingMessageJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new InvalidJobPayloadError(
      'incoming-message',
      parsed.error.issues.map((issue) => issue.path.join('.')),
    );
  }
  const data = parsed.data;

  const payload: NormalizedPayload = {
    messageType: data.messageType,
    chatId: data.chatId,
    userId: data.userId,
    text: data.text,
    callbackData:
      data.callbackData === undefined
        ? undefined
        : data.callbackData.field === undefined
          ? { action: data.callbackData.action }
          : { action: data.callbackData.action, field: data.callbackData.field },
    timestamp: new Date(data.timestamp),
    channel: data.channel,
    externalMessageId: data.externalMessageId,
    rawPayload: data.rawPayload,
  };

  await routeIncomingMessage.execute(payload);
}

export function createIncomingMessageWorker(opts: {
  redis: Redis;
  routeIncomingMessage: RouteIncomingMessage;
  logger: Logger;
}): Worker<IncomingMessageJobData> {
  const worker = new Worker<IncomingMessageJobData>(
    'incoming-message',
    async (job: Job<IncomingMessageJobData>) =>
      processIncomingMessageJob(job, opts.routeIncomingMessage),
    {
      connection: opts.redis,
      concurrency: 1, // strict FIFO per user (ADR-011)
      stalledInterval: 120_000, // 2 min (default 30s) — reduce Redis evalsha calls
      // Retry policy is set on Queue, not Worker
    },
  );

  // Structured error logging so the worker does not crash on processor errors
  worker.on('failed', (job, err) => {
    opts.logger.error({
      msg: 'Incoming message worker failed permanently',
      jobId: job?.id,
      queue: 'incoming-message',
      code: err instanceof InvalidJobPayloadError ? err.code : 'JOB_FAILED',
      ...(err instanceof InvalidJobPayloadError ? { validationPaths: err.paths } : {}),
    });
  });

  return worker;
}
