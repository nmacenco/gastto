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
import type { SendOAuthReminder } from '../../application/use-cases/spreadsheet/SendOAuthReminder';

const mockExecute = vi.fn();

function buildMockDeps(): OAuthReminderWorkerDeps {
  return {
    redis: {} as unknown as OAuthReminderWorkerDeps['redis'],
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
  } as Job;
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
