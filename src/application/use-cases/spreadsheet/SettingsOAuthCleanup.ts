import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { SettingsOAuthPayload } from './SettingsOAuthFlow';

export class SettingsOAuthCleanup {
  constructor(
    private readonly redis: Redis,
    private readonly reminderQueue: Queue,
    private readonly logger: Logger,
  ) {}

  async execute(payload: Pick<SettingsOAuthPayload, 'state' | 'reminderJobId'>): Promise<void> {
    try {
      await this.redis.del(`oauth:state:${payload.state}`);
    } catch (error) {
      this.logger.error({
        msg: 'Failed to remove settings OAuth nonce',
        endpoint: 'SettingsOAuthCleanup',
        code: 'NONCE_CLEANUP_FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      await this.reminderQueue.remove(payload.reminderJobId);
    } catch (error) {
      this.logger.error({
        msg: 'Failed to remove settings OAuth reminder',
        endpoint: 'SettingsOAuthCleanup',
        code: 'REMINDER_CLEANUP_FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
