import { DelayedError } from 'bullmq';

interface PausableWorker {
  pause(doNotWaitActive?: boolean): Promise<void>;
}

interface DelayableJob {
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

interface QuarantineLogger {
  error(payload: { msg: string; endpoint: string; code: string }): void;
}

/** Keep the claimed job retryable without consuming attempts while this worker stops. */
export async function assertRestoreSafe(
  guard: { assertCurrent(): Promise<void> } | undefined,
  job: DelayableJob,
  token: string | undefined,
  worker: PausableWorker,
  logger: QuarantineLogger,
): Promise<void> {
  if (!guard) return;
  try {
    await guard.assertCurrent();
  } catch {
    if (!token) throw new Error('REDIS_RESTORE_TOKEN_MISSING');
    await worker.pause(true);
    logger.error({
      msg: 'Worker paused because Redis restore state is unverified',
      endpoint: 'redis',
      code: 'REDIS_RESTORE_QUARANTINE',
    });
    await job.moveToDelayed(Date.now() + 60_000, token);
    throw new DelayedError();
  }
}
