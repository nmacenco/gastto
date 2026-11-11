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

export type OperatorMailFailureStage =
  | 'token_request'
  | 'token_response'
  | 'send_request'
  | 'send_response';

export class OperatorMailError extends Error {
  constructor(
    readonly stage: OperatorMailFailureStage,
    readonly httpStatus: number | null = null,
    readonly providerReason: string | null = null,
  ) {
    super(`Operator Gmail failed at ${stage}`);
    this.name = 'OperatorMailError';
  }
}

export function operatorMailFailureContext(error: unknown): {
  errorType: string;
  mailStage?: OperatorMailFailureStage;
  mailStatus?: number;
  mailReason?: string;
} {
  if (error instanceof OperatorMailError) {
    return {
      errorType: error.name,
      mailStage: error.stage,
      ...(error.httpStatus === null ? {} : { mailStatus: error.httpStatus }),
      ...(error.providerReason === null ? {} : { mailReason: error.providerReason }),
    };
  }
  return { errorType: error instanceof Error ? error.constructor.name : 'unknown' };
}
