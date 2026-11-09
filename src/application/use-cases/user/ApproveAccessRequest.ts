import type {
  AccessRequestRepository,
  AccessApprovalOutcome,
} from '../../../domain/ports/AccessRequestRepository';
import type { IUserRepository } from '../../../domain/ports/repositories';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { accessCopies } from '../../copies/access.copies';

export class ApproveAccessRequest {
  constructor(
    private readonly requests: AccessRequestRepository,
    private readonly users: IUserRepository,
    private readonly telegram: MessagingOutputPort,
  ) {}

  async execute(input: {
    requestId: string;
    operatorIdentity: string;
  }): Promise<AccessApprovalOutcome> {
    const outcome = await this.requests.approve(input.requestId, input.operatorIdentity);
    if (outcome.status !== 'approved' && outcome.status !== 'already_approved') return outcome;
    if (outcome.request.approvalNoticeSentAt) return outcome;

    const identities = await this.users.findMessagingIdentitiesByUserId(outcome.request.userId);
    const chat = identities.find((identity) => identity.channel === 'telegram');
    if (!chat) throw new Error('Approved user has no Telegram identity');
    const result = await this.telegram.sendMessage(
      chat.externalId,
      outcome.request.kind === 'replacement'
        ? accessCopies.replacementApprovedNotice()
        : accessCopies.approvedNotice(),
    );
    if (result.status !== 'success') throw new Error('Telegram approval notice failed');
    await this.requests.markApprovalNoticeSent(outcome.request.id);
    return outcome;
  }
}
