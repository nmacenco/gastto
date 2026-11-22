import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { AccountDeletionService } from '../../application/services/AccountDeletionService';

export function createAccountDeletionWorker(deps: {
  redis: Redis;
  service: AccountDeletionService;
  logger: Logger;
  restoreGuard?: { assertCurrent(): Promise<void> };
}): Worker<{ userId: string }> {
  const worker = new Worker<{ userId: string }>(
    'account-deletion',
    async (job: Job<{ userId: string }>) => {
      await deps.restoreGuard?.assertCurrent();
      if (typeof job.data.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(job.data.userId)) {
        throw new Error('INVALID_ACCOUNT_DELETION_JOB');
      }
      try {
        await deps.service.resume(job.data.userId);
      } catch {
        // BullMQ persists failure messages and stacks while retrying. Keep
        // provider, database, and credential details out of retained jobs.
        throw new Error('ACCOUNT_DELETION_RETRY_REQUIRED');
      }
    },
    { connection: deps.redis, concurrency: 1 },
  );
  worker.on('failed', (_job, error) => {
    deps.logger.error({
      msg: 'Account deletion job failed; retry or recovery scan required',
      endpoint: 'account-deletion',
      code: 'ACCOUNT_DELETION_JOB_FAILED',
      errorType: error.constructor.name,
    });
  });
  return worker;
}
