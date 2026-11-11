// LAYER: Application
// Use case: sends the immediate "received, processing" acknowledgment to the user.
// Keeps the acknowledgment logic isolated so the router stays focused on routing.

import type { SendResult, MessagingOutputPort } from '../../ports/output/messaging.port';
import { sharedCopies } from '../../copies/shared.copies';
import type { AccessRequestRepository } from '../../../domain/ports/AccessRequestRepository';
import type { IUserRepository } from '../../../domain/ports/repositories';

export interface SendImmediateAcknowledgementInput {
  readonly chatId: string;
  readonly channel: 'telegram' | 'whatsapp';
  readonly userId?: string | undefined;
}

export class SendImmediateAcknowledgement {
  constructor(
    private readonly messagingPort: MessagingOutputPort,
    private readonly accessRequests?: AccessRequestRepository,
    private readonly userRepository?: IUserRepository,
  ) {}

  async execute(input: SendImmediateAcknowledgementInput): Promise<SendResult> {
    try {
      if (input.channel === 'telegram' && this.accessRequests && this.userRepository) {
        const user = await this.userRepository.findByMessagingIdentity(input.channel, input.chatId);
        if (!user || !(await this.accessRequests.findApproved(user.userId))) {
          return { status: 'success' };
        }
      }
      return await this.messagingPort.sendMessage(
        input.chatId,
        sharedCopies.processingAcknowledgment(),
      );
    } catch {
      return { status: 'failure', errorCode: 'SEND_FAILED' };
    }
  }
}
