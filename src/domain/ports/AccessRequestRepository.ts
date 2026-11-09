export type AccessRequestKind = 'initial' | 'replacement';
export type AccessRequestStatus = 'pending' | 'approved' | 'superseded';

export interface AccessRequest {
  id: string;
  userId: string;
  email: string;
  kind: AccessRequestKind;
  status: AccessRequestStatus;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  activatedAt: Date | null;
  notificationSentAt: Date | null;
  approvalNoticeSentAt: Date | null;
}

export interface AccessRequestSubmission {
  request: AccessRequest;
  previousEmail: string | null;
  created: boolean;
}

export type AccessApprovalOutcome =
  | { status: 'approved' | 'already_approved'; request: AccessRequest }
  | { status: 'not_current' | 'not_found' };

export interface AccessRequestRepository {
  findApproved(userId: string): Promise<AccessRequest | null>;
  findApprovedReplacement(userId: string): Promise<AccessRequest | null>;
  findPending(userId: string): Promise<AccessRequest | null>;
  findById(id: string): Promise<AccessRequest | null>;
  submit(userId: string, email: string, kind: AccessRequestKind): Promise<AccessRequestSubmission>;
  approve(id: string, actor: string): Promise<AccessApprovalOutcome>;
  markNotificationSent(id: string): Promise<void>;
  markApprovalNoticeSent(id: string): Promise<void>;
}
