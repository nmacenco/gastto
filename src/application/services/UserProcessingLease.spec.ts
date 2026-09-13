import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { IUserProcessingLock } from '../ports/UserProcessingLock';
import type { TransitionConversationState } from '../use-cases/conversation/TransitionConversationState';
import {
  startUserProcessingLeaseRenewal,
  USER_PROCESSING_LEASE_RENEW_MS,
} from './UserProcessingLease';

describe('startUserProcessingLeaseRenewal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    ['lost token', vi.fn().mockResolvedValue(false), 'LOCK_RENEW_LOST'],
    ['Redis failure', vi.fn().mockRejectedValue(new Error('Redis unavailable')), 'LOCK_RENEW_FAILED'],
  ])('invalidates and logs a structured error after %s', async (_name, renew, code) => {
    const invalidateExecution = vi.fn();
    const error = vi.fn();
    const stop = startUserProcessingLeaseRenewal({
      userId: 'user-1',
      token: 'token-1',
      lock: { renew } as unknown as IUserProcessingLock,
      transitionState: { invalidateExecution } as unknown as TransitionConversationState,
      logger: { error } as unknown as Logger,
      endpoint: 'LeaseTest',
    });

    await vi.advanceTimersByTimeAsync(USER_PROCESSING_LEASE_RENEW_MS);
    stop();

    expect(invalidateExecution).toHaveBeenCalledWith('user-1');
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'LeaseTest', code, userId: 'user-1' }),
    );
  });
});
