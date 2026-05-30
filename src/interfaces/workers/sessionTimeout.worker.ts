// LAYER: Interfaces
// BullMQ worker — periodic session timeout handler.
// Consumes repeatable `session-timeout` jobs and delegates to
// HandleExpiredSessions use case.

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { HandleExpiredSessions } from '../../application/use-cases/conversation/HandleExpiredSessions';

export interface SessionTimeoutWorkerOpts {
  redis: Redis;
  handleExpiredSessions: HandleExpiredSessions;
}

export async function processSessionTimeoutJob(
  _job: Job,
  handleExpiredSessions: HandleExpiredSessions,
): Promise<void> {
  await handleExpiredSessions.execute();
}

export function createSessionTimeoutWorker(opts: SessionTimeoutWorkerOpts): Worker {
  const worker = new Worker(
    'session-timeout',
    async (job: Job) => processSessionTimeoutJob(job, opts.handleExpiredSessions),
    {
      connection: opts.redis,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    console.error({
      msg: 'Session timeout worker failed permanently',
      jobId: job?.id,
      data: job?.data as unknown,
      error: err.message,
    });
  });

  return worker;
}
