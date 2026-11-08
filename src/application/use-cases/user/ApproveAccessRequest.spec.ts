import { describe, expect, it, vi } from 'vitest';
import { ApproveAccessRequest } from './ApproveAccessRequest';
import type {
  AccessRequestRepository,
  AccessRequest,
} from '../../../domain/ports/AccessRequestRepository';
import type { IUserRepository } from '../../../domain/ports/repositories';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';

const request: AccessRequest = {
  id: 'request-1',
  userId: 'user-1',
  email: 'user@example.com',
  kind: 'initial',
  status: 'approved',
  createdAt: new Date(),
  decidedAt: new Date(),
  decidedBy: 'project-owner',
  activatedAt: new Date(),
  notificationSentAt: null,
  approvalNoticeSentAt: null,
};

describe('ApproveAccessRequest', () => {
  it('resends a failed post-commit Telegram notice on an idempotent CLI rerun', async () => {
    const approve = vi
      .fn()
      .mockResolvedValueOnce({ status: 'approved', request })
      .mockResolvedValueOnce({ status: 'already_approved', request });
    const markApprovalNoticeSent = vi.fn();
    const requests = { approve, markApprovalNoticeSent } as unknown as AccessRequestRepository;
    const users = {
      findMessagingIdentitiesByUserId: vi
        .fn()
        .mockResolvedValue([{ channel: 'telegram', externalId: '12345' }]),
    } as unknown as IUserRepository;
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ status: 'failure' })
      .mockResolvedValueOnce({ status: 'success' });
    const telegram = { sendMessage } as unknown as MessagingOutputPort;
    const useCase = new ApproveAccessRequest(requests, users, telegram);

    await expect(
      useCase.execute({ requestId: request.id, operatorIdentity: 'project-owner' }),
    ).rejects.toThrow('Telegram approval notice failed');
    expect(markApprovalNoticeSent).not.toHaveBeenCalled();
    const outcome = await useCase.execute({
      requestId: request.id,
      operatorIdentity: 'project-owner',
    });
    expect(outcome.status).toBe('already_approved');
    expect(markApprovalNoticeSent).toHaveBeenCalledWith(request.id);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
