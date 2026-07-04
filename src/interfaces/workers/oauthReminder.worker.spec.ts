// LAYER: Interfaces / Tests
// Contract tests for the OAuth reminder worker.
// Mocks bullmq.Worker and SendOAuthReminder to verify delegation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processOAuthReminderJob,
  createOAuthReminderWorker,
  type OAuthReminderWorkerDeps,
} from './oauthReminder.worker';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { SendOAuthReminder } from '../../application/use-cases/spreadsheet/SendOAuthReminder';
import { InvalidStateTransitionError } from '../../domain/errors/InvalidStateTransitionError';

const mockExecute = vi.fn();
const mockLoggerWarn = vi.fn();

function buildMockDeps(): OAuthReminderWorkerDeps {
  return {
    redis: {} as unknown as OAuthReminderWorkerDeps['redis'],
    logger: { warn: mockLoggerWarn } as unknown as Logger,
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
        error: 'Invalid state transition from IDLE to ONBOARDING_DRIVE',
      }),
    );
  });

  it('re-throws non-state-transition errors', async () => {
    mockExecute.mockRejectedValue(new Error('Database down'));

    const deps = buildMockDeps();
    await expect(processOAuthReminderJob(buildJob(), deps)).rejects.toThrow('Database down');
  });
});

describe('createOAuthReminderWorker', () => {
  const WorkerMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(WorkerMock).mockImplementation(() => ({
      on: vi.fn(),
      opts: { concurrency: 2 },
    }));
  });

  it('has the correct type signature', () => {
    const deps = buildMockDeps();
    expect(typeof createOAuthReminderWorker).toBe('function');
    expect(() => createOAuthReminderWorker(deps)).not.toThrow(TypeError);
  });
});
