import type { IUserProcessingLock } from '../ports/UserProcessingLock';
import type { TransitionConversationState } from '../use-cases/conversation/TransitionConversationState';
import type { Logger } from 'pino';

export const USER_PROCESSING_LEASE_TTL_MS = 180_000;
export const USER_PROCESSING_LEASE_RENEW_MS = 30_000;

export function startUserProcessingLeaseRenewal(input: {
  userId: string;
  token: string;
  lock: IUserProcessingLock;
  transitionState: TransitionConversationState;
  logger?: Logger;
  endpoint?: string;
}): () => void {
  let renewalInFlight = false;
  const timer = setInterval(() => {
    if (renewalInFlight) return;
    renewalInFlight = true;
    void input.lock
      .renew(input.userId, input.token, USER_PROCESSING_LEASE_TTL_MS)
      .then((renewed) => {
        if (!renewed) {
          input.transitionState.invalidateExecution(input.userId);
          input.logger?.error({
            msg: 'Lost per-user processing lock during renewal',
            endpoint: input.endpoint ?? 'UserProcessingLease',
            code: 'LOCK_RENEW_LOST',
            userId: input.userId,
          });
        }
      })
      .catch((error: unknown) => {
        input.transitionState.invalidateExecution(input.userId);
        input.logger?.error({
          msg: 'Failed to renew per-user processing lock',
          endpoint: input.endpoint ?? 'UserProcessingLease',
          code: 'LOCK_RENEW_FAILED',
          userId: input.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        renewalInFlight = false;
      });
  }, USER_PROCESSING_LEASE_RENEW_MS);
  timer.unref();
  return () => clearInterval(timer);
}
