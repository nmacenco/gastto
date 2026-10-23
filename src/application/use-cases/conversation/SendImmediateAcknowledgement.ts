// LAYER: Application
// Use case: sends the immediate "received, processing" acknowledgment to the user.
// Keeps the acknowledgment logic isolated so the router stays focused on routing.

import type { SendResult, MessagingOutputPort } from '../../ports/output/messaging.port';
import { sharedCopies } from '../../copies/shared.copies';

export interface SendImmediateAcknowledgementInput {
  readonly chatId: string;
  readonly channel: 'telegram' | 'whatsapp';
  readonly userId?: string | undefined;
}

export class SendImmediateAcknowledgement {
  constructor(private readonly messagingPort: MessagingOutputPort) {}

  async execute(input: SendImmediateAcknowledgementInput): Promise<SendResult> {
    try {
      return await this.messagingPort.sendMessage(
        input.chatId,
        sharedCopies.processingAcknowledgment(),
      );
    } catch {
      return { status: 'failure', errorCode: 'SEND_FAILED' };
    }
  }
}
