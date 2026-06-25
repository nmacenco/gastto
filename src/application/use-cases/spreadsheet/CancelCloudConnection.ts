// LAYER: Application
// Use case: cancel the OAuth flow when the user types "cancelar" during ONBOARDING_DRIVE.
// Removes the CSRF state from Redis, cancels the pending BullMQ reminder job,
// transitions the FSM back to IDLE, and sends a cancellation message.

import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import { onboardingCopies } from '../../copies/onboarding.copies';

export interface CancelCloudConnectionInput {
  userId: string;
  state: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
}

export interface CancelCloudConnectionOutput {
  nextState: FsmState;
  message: string;
}

export interface CancelCloudConnectionDeps {
  redis: Redis;
  reminderQueue: Queue;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  logger: Logger;
}

export class CancelCloudConnection {
  constructor(private readonly deps: CancelCloudConnectionDeps) {}

  async execute(input: CancelCloudConnectionInput): Promise<CancelCloudConnectionOutput> {
    const { userId, state, externalId } = input;
    const redisKey = `oauth:state:${state}`;

    const raw = await this.deps.redis.get(redisKey);
    let reminderJobId: string | undefined;

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { reminderJobId?: string };
        reminderJobId = parsed.reminderJobId;
      } catch {
        // ignore parse errors
      }

      try {
        await this.deps.redis.del(redisKey);
      } catch {
        // non-critical
      }
    }

    if (reminderJobId) {
      try {
        await this.deps.reminderQueue.remove(reminderJobId);
      } catch (removeErr) {
        this.deps.logger.error({
          endpoint: 'CancelCloudConnection',
          code: 'REMINDER_CANCEL_FAILED',
          jobId: reminderJobId,
          error: String(removeErr),
        });
      }
    }

    await this.deps.transitionState.execute({
      userId,
      targetState: 'IDLE',
      payload: null,
    });

    const message = onboardingCopies.cancelledMessage();
    await this.deps.messagingPort.sendMessage(externalId, message);

    return { nextState: 'IDLE', message };
  }
}
