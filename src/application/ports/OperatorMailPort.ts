import type { AccessRequestKind } from '../../domain/ports/AccessRequestRepository';

export interface AccessRequestNotice {
  requestId: string;
  chatId: string;
  email: string;
  kind: AccessRequestKind;
  previousEmail: string | null;
}

export interface OperatorMailPort {
  sendAccessRequestNotice(notice: AccessRequestNotice): Promise<void>;
}
