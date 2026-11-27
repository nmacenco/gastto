import type {
  AccessRequestKind,
  AccessRequestRepository,
  AccessRequestSubmission,
} from '../../../domain/ports/AccessRequestRepository';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class RequestAccess {
  constructor(private readonly repository: AccessRequestRepository) {}

  async execute(input: {
    userId: string;
    rawEmail: string;
    kind: AccessRequestKind;
  }): Promise<{ status: 'invalid' } | { status: 'submitted'; result: AccessRequestSubmission }> {
    const email = input.rawEmail.trim().toLowerCase();
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) return { status: 'invalid' };
    return {
      status: 'submitted',
      result: await this.repository.submit(input.userId, email, input.kind),
    };
  }
}
