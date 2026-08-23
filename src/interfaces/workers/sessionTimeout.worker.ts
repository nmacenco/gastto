// LAYER: Interfaces
// BullMQ worker — periodic session timeout handler.
// Consumes repeatable `session-timeout` jobs and delegates to
// HandleExpiredSessions use case.

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { HandleExpiredSessions } from '../../application/use-cases/conversation/HandleExpiredSessions';
import {
  SessionTimeoutJobDataSchema,
  type SessionTimeoutJobData,
} from '../../application/ports/SessionTimeoutJob';
import { InvalidJobPayloadError } from '../../application/ports/InvalidJobPayloadError';
import { BULLMQ_WORKER_DRAIN_DELAY_SECONDS, registerBullMqErrorListener } from './bullMqRuntime';

export interface SessionTimeoutWorkerOpts {
  redis: Redis;
  handleExpiredSessions: HandleExpiredSessions;
  logger: Logger;
}

export async function processSessionTimeoutJob(
  job: Job<SessionTimeoutJobData>,
  handleExpiredSessions: HandleExpiredSessions,
): Promise<void> {
  const parsed = SessionTimeoutJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new InvalidJobPayloadError(
      'session-timeout',
      parsed.error.issues.map((issue) => issue.path.join('.')),
    );
  }
  await handleExpiredSessions.execute();
}

export function createSessionTimeoutWorker(
  opts: SessionTimeoutWorkerOpts,
): Worker<SessionTimeoutJobData> {
  const worker = new Worker<SessionTimeoutJobData>(
    'session-timeout',
    async (job: Job<SessionTimeoutJobData>) =>
      processSessionTimeoutJob(job, opts.handleExpiredSessions),
    {
      connection: opts.redis,
      concurrency: 1,
      drainDelay: BULLMQ_WORKER_DRAIN_DELAY_SECONDS,
      stalledInterval: 120_000, // 2 min (default 30s) — reduce Redis evalsha calls
    },
  );

  registerBullMqErrorListener(worker, {
    logger: opts.logger,
    queue: 'session-timeout',
    resourceKind: 'worker',
  });

  worker.on('failed', (job, err) => {
    opts.logger.error({
      msg: 'Session timeout worker failed permanently',
      jobId: job?.id,
      queue: 'session-timeout',
      code: err instanceof InvalidJobPayloadError ? err.code : 'JOB_FAILED',
      ...(err instanceof InvalidJobPayloadError ? { validationPaths: err.paths } : {}),
    });
  });

  return worker;
}
