// LAYER: Interfaces
// BullMQ worker — OAuth reminder handler.
// Consumes `oauth-reminder` jobs and delegates to SendOAuthReminder use case.

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { SendOAuthReminder } from '../../application/use-cases/spreadsheet/SendOAuthReminder';
import { InvalidStateTransitionError } from '../../domain/errors/InvalidStateTransitionError';
import type { IUserRepository } from '../../domain/ports/repositories';
import {
  OAuthReminderJobDataSchema,
  type OAuthReminderJobData,
} from '../../application/ports/OAuthReminderJob';
import { InvalidJobPayloadError } from '../../application/ports/InvalidJobPayloadError';

export type { OAuthReminderJobData } from '../../application/ports/OAuthReminderJob';

export interface OAuthReminderWorkerDeps {
  redis: Redis;
  sendOAuthReminder: SendOAuthReminder;
  redirectUri: string;
  logger: Logger;
  userRepo: IUserRepository;
  provider?: 'google' | 'microsoft';
}

export async function processOAuthReminderJob(
  job: Job<OAuthReminderJobData>,
  deps: OAuthReminderWorkerDeps,
): Promise<void> {
  const parsed = OAuthReminderJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new InvalidJobPayloadError(
      'oauth-reminder',
      parsed.error.issues.map((issue) => issue.path.join('.')),
    );
  }
  const { userId, externalId, channel } = parsed.data;
  const identity = await deps.userRepo.findByMessagingIdentity(channel, externalId);
  if (identity?.userId !== userId) {
    throw new Error('Messaging identity does not match job user');
  }
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
        code: 'INVALID_STATE_TRANSITION',
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
      stalledInterval: 120_000, // 2 min (default 30s) — reduce Redis evalsha calls
    },
  );

  worker.on('failed', (job, err) => {
    deps.logger.error({
      msg: 'OAuth reminder worker failed permanently',
      jobId: job?.id,
      queue: 'oauth-reminder',
      code: err instanceof InvalidJobPayloadError ? err.code : 'JOB_FAILED',
      ...(err instanceof InvalidJobPayloadError ? { validationPaths: err.paths } : {}),
    });
  });

  return worker;
}
