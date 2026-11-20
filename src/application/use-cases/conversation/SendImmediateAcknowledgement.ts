// LAYER: Application
// Use case: sends the immediate "received, processing" acknowledgment to the user.
// Keeps the acknowledgment logic isolated so the router stays focused on routing.

import type { SendResult, MessagingOutputPort } from '../../ports/output/messaging.port';
import { sharedCopies } from '../../copies/shared.copies';
import type { AccessRequestRepository } from '../../../domain/ports/AccessRequestRepository';
import type { IUserRepository } from '../../../domain/ports/repositories';
import type { AccountExternalWorkFence } from '../../ports/AccountExternalWorkFence';
import { AccountDeletionInProgressError } from '../../ports/AccountExternalWorkFence';

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
    private readonly accountDeletionGate?: {
      isIdentityDeleting(channel: string, externalId: string): Promise<boolean>;
    },
    private readonly accountExternalWorkFence?: AccountExternalWorkFence,
  ) {}

  async execute(input: SendImmediateAcknowledgementInput): Promise<SendResult> {
    try {
      if (await this.accountDeletionGate?.isIdentityDeleting(input.channel, input.chatId)) {
        return { status: 'success' };
      }
      let verifiedUserId: string | undefined;
      if (input.channel === 'telegram' && this.userRepository) {
        const user = await this.userRepository.findByMessagingIdentity(input.channel, input.chatId);
        if (
          !user ||
          (this.accessRequests && !(await this.accessRequests.findApproved(user.userId)))
        ) {
          return { status: 'success' };
        }
        verifiedUserId = user.userId;
      }
      const send = () =>
        this.messagingPort.sendMessage(input.chatId, sharedCopies.processingAcknowledgment());
      return verifiedUserId && this.accountExternalWorkFence
        ? await this.accountExternalWorkFence.run(verifiedUserId, send)
        : await send();
    } catch (error) {
      if (error instanceof AccountDeletionInProgressError) return { status: 'success' };
      return { status: 'failure', errorCode: 'SEND_FAILED' };
    }
  }
}
