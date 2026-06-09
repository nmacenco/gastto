// LAYER: Interfaces
// BullMQ worker — Stage 1.5 of the async pipeline.
// Consumes `incoming-message` jobs in the same persistent process as Fastify.
// Responsibilities: guarantee FIFO per user by running with concurrency: 1,
// deserialize job data back to NormalizedPayload, and delegate to
// RouteIncomingMessage use case.

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { RouteIncomingMessage } from '../../application/use-cases/conversation/RouteIncomingMessage';
import type { IncomingMessageJobData } from '../../application/ports/IncomingMessageJob';
import type { NormalizedPayload } from '../../domain/ports/messaging';

export async function processIncomingMessageJob(
  job: Job<IncomingMessageJobData>,
  routeIncomingMessage: RouteIncomingMessage,
): Promise<void> {
  const data = job.data;

  const payload: NormalizedPayload = {
    messageType: data.messageType,
    chatId: data.chatId,
    userId: data.userId,
    text: data.text,
    timestamp: new Date(data.timestamp),
    channel: data.channel,
    rawPayload: data.rawPayload,
  };

  await routeIncomingMessage.execute(payload);
}

export function createIncomingMessageWorker(opts: {
  redis: Redis;
  routeIncomingMessage: RouteIncomingMessage;
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
    console.error({
      msg: 'Incoming message worker failed permanently',
      jobId: job?.id,
      data: job?.data,
      error: err.message,
    });
  });

  return worker;
}
