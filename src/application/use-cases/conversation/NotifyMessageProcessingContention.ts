// LAYER: Application
// Best-effort notice for a message that exhausted retries before acquiring
// the per-user processing lock. No state or financial operation is touched.

import type { Logger } from 'pino';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { sharedCopies } from '../../copies/shared.copies';

export interface NotifyMessageProcessingContentionInput {
  channel: 'telegram' | 'whatsapp';
  externalId: string;
  externalMessageId: string;
}

export class NotifyMessageProcessingContention {
  constructor(
    private readonly messagingAdapters: Record<'telegram' | 'whatsapp', MessagingOutputPort>,
    private readonly logger: Logger,
  ) {}

  async execute(input: NotifyMessageProcessingContentionInput): Promise<void> {
    try {
      const result = await this.messagingAdapters[input.channel].sendMessage(
        input.externalId,
        sharedCopies.processingContentionExhausted(),
      );
      if (result.status === 'failure') {
        this.logger.error({
          msg: 'Failed to send processing contention notice',
          endpoint: 'NotifyMessageProcessingContention',
          code: 'CONTENTION_NOTICE_FAILED',
          channel: input.channel,
          externalMessageId: input.externalMessageId,
          deliveryCode: result.errorCode,
        });
      }
    } catch (error) {
      this.logger.error({
        msg: 'Failed to send processing contention notice',
        endpoint: 'NotifyMessageProcessingContention',
        code: 'CONTENTION_NOTICE_FAILED',
        channel: input.channel,
        externalMessageId: input.externalMessageId,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
      });
    }
  }
}
