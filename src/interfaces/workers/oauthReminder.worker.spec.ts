// LAYER: Interfaces / Tests
// Contract tests for the OAuth reminder worker.
// Mocks bullmq.Worker and SendOAuthReminder to verify delegation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processOAuthReminderJob,
  createOAuthReminderWorker,
  type OAuthReminderWorkerDeps,
} from './oauthReminder.worker';
import { Worker, type Job } from 'bullmq';
import type { Logger } from 'pino';
import type { SendOAuthReminder } from '../../application/use-cases/spreadsheet/SendOAuthReminder';
import { InvalidStateTransitionError } from '../../domain/errors/InvalidStateTransitionError';
import { InvalidJobPayloadError } from '../../application/ports/InvalidJobPayloadError';

const mockExecute = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockFindByMessagingIdentity = vi.fn();

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => {
    const events: Record<string, Array<(...args: unknown[]) => void>> = {};
    return {
      opts: { concurrency: 2 },
      on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (!events[event]) events[event] = [];
        events[event].push(handler);
      }),
      emit: vi.fn().mockImplementation((event: string, ...args: unknown[]) => {
        (events[event] ?? []).forEach((handler) => handler(...args));
      }),
    };
  }),
}));

function buildMockDeps(): OAuthReminderWorkerDeps {
  return {
    redis: {} as unknown as OAuthReminderWorkerDeps['redis'],
    logger: { warn: mockLoggerWarn, error: mockLoggerError } as unknown as Logger,
    userRepo: {
      findByMessagingIdentity: mockFindByMessagingIdentity,
    } as unknown as OAuthReminderWorkerDeps['userRepo'],
    sendOAuthReminder: { execute: mockExecute } as unknown as SendOAuthReminder,
    redirectUri: 'http://localhost:3000/auth/google/callback',
  };
}

function buildJob(): Job<{ userId: string; externalId: string; channel: 'telegram' | 'whatsapp' }> {
  return {
    data: {
      userId: 'user-123',
      externalId: '987654321',
      channel: 'telegram',
    },
  } as Job<{ userId: string; externalId: string; channel: 'telegram' | 'whatsapp' }>;
}

describe('processOAuthReminderJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByMessagingIdentity.mockResolvedValue({ userId: 'user-123' });
  });

  it('delegates to SendOAuthReminder with job data and default provider', async () => {
    const deps = buildMockDeps();
    await processOAuthReminderJob(buildJob(), deps);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      externalId: '987654321',
      channel: 'telegram',
      provider: 'google',
      redirectUri: 'http://localhost:3000/auth/google/callback',
    });
  });

  it('uses custom provider when provided', async () => {
    const deps = buildMockDeps();
    deps.provider = 'microsoft';
    await processOAuthReminderJob(buildJob(), deps);

    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ provider: 'microsoft' }));
  });

  it('logs warning and resolves gracefully on InvalidStateTransitionError', async () => {
    mockExecute.mockRejectedValue(new InvalidStateTransitionError('IDLE', 'ONBOARDING_DRIVE'));

    const deps = buildMockDeps();
    await processOAuthReminderJob(buildJob(), deps);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'OAuth reminder skipped: invalid state transition',
        userId: 'user-123',
        code: 'INVALID_STATE_TRANSITION',
      }),
    );
  });

  it('re-throws non-state-transition errors', async () => {
    mockExecute.mockRejectedValue(new Error('Database down'));

    const deps = buildMockDeps();
    await expect(processOAuthReminderJob(buildJob(), deps)).rejects.toThrow('Database down');
  });

  it('rejects malformed job data before sending a reminder', async () => {
    const deps = buildMockDeps();
    const job = { data: { userId: 'user-123', channel: 'invalid' } } as Job;

    await expect(processOAuthReminderJob(job as Job<never>, deps)).rejects.toThrow(
      InvalidJobPayloadError,
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects mismatched messaging identity before sending a reminder', async () => {
    const deps = buildMockDeps();
    mockFindByMessagingIdentity.mockResolvedValue({ userId: 'other-user' });

    await expect(processOAuthReminderJob(buildJob(), deps)).rejects.toThrow(
      'Messaging identity does not match job user',
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('createOAuthReminderWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a Worker with concurrency: 2 and drainDelay: 30', () => {
    const deps = buildMockDeps();
    createOAuthReminderWorker(deps);

    const [, , opts] = vi.mocked(Worker).mock.calls[0] as unknown as [
      unknown,
      unknown,
      { concurrency: number; drainDelay: number },
    ];
    expect(opts.concurrency).toBe(2);
    expect(opts.drainDelay).toBe(30);
  });

  it('logs a sanitized structured error once on worker error events', () => {
    const worker = createOAuthReminderWorker(buildMockDeps());

    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'error',
      new Error('Connection lost'),
    );

    expect(mockLoggerError).toHaveBeenCalledOnce();
    expect(mockLoggerError).toHaveBeenCalledWith({
      msg: 'BullMQ worker error',
      endpoint: 'bullmq',
      code: 'BULLMQ_WORKER_ERROR',
      queue: 'oauth-reminder',
      error: 'Connection lost',
    });
  });
});
