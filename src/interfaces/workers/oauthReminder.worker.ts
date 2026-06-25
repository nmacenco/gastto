// LAYER: Interfaces
// BullMQ worker — OAuth reminder handler.
// Consumes `oauth-reminder` jobs and delegates to SendOAuthReminder use case.

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { SendOAuthReminder } from '../../application/use-cases/spreadsheet/SendOAuthReminder';
import { InvalidStateTransitionError } from '../../domain/errors/InvalidStateTransitionError';

export interface OAuthReminderJobData {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
}

export interface OAuthReminderWorkerDeps {
  redis: Redis;
  sendOAuthReminder: SendOAuthReminder;
  redirectUri: string;
  logger: Logger;
  provider?: 'google' | 'microsoft';
}

export async function processOAuthReminderJob(
  job: Job<OAuthReminderJobData>,
  deps: OAuthReminderWorkerDeps,
): Promise<void> {
  const { userId, externalId, channel } = job.data;
  const provider = deps.provider ?? 'google';

  try {
    await deps.sendOAuthReminder.execute({
      userId,
      externalId,
      channel,
      provider,
      redirectUri: deps.redirectUri,
    });
  } catch (err) {
    if (err instanceof InvalidStateTransitionError) {
      deps.logger.warn({
        msg: 'OAuth reminder skipped: invalid state transition',
        jobId: job.id,
        userId,
        error: err.message,
      });
      return;
    }
    throw err;
  }
}

export function createOAuthReminderWorker(
  deps: OAuthReminderWorkerDeps,
): Worker<OAuthReminderJobData> {
  const worker = new Worker<OAuthReminderJobData>(
    'oauth-reminder',
    async (job: Job<OAuthReminderJobData>) => processOAuthReminderJob(job, deps),
    {
      connection: deps.redis,
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    deps.logger.error({
      msg: 'OAuth reminder worker failed permanently',
      jobId: job?.id,
      data: job?.data,
      error: err.message,
    });
  });

  return worker;
}
