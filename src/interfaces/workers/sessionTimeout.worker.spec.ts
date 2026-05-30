// LAYER: Interfaces / Tests
// Unit tests for the session timeout worker.
// Mocks bullmq.Worker so no real Redis is needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { HandleExpiredSessions } from '../../application/use-cases/conversation/HandleExpiredSessions';
import { processSessionTimeoutJob, createSessionTimeoutWorker } from './sessionTimeout.worker';

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => {
    const events: Record<string, Array<(...args: unknown[]) => void>> = {};
    return {
      opts: { concurrency: 1 },
      on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (!events[event]) events[event] = [];
        events[event].push(handler);
      }),
      emit: vi.fn().mockImplementation((event: string, ...args: unknown[]) => {
        (events[event] ?? []).forEach((handler) => handler(...args));
      }),
      _events: events,
    };
  }),
}));

const mockExecute = vi.fn();

function buildMockHandleExpiredSessions(): HandleExpiredSessions {
  return { execute: mockExecute } as unknown as HandleExpiredSessions;
}

function buildMockRedis(): Redis {
  return {} as unknown as Redis;
}

describe('processSessionTimeoutJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
  });

  it('delegates to HandleExpiredSessions.execute', async () => {
    const mockJob = { id: 'job-1', data: {} } as Job;
    const handleExpiredSessions = buildMockHandleExpiredSessions();

    await processSessionTimeoutJob(mockJob, handleExpiredSessions);

    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('propagates error so BullMQ can mark the job as failed', async () => {
    mockExecute.mockRejectedValue(new Error('Execution failed'));

    const mockJob = { id: 'job-2', data: {} } as Job;
    const handleExpiredSessions = buildMockHandleExpiredSessions();

    await expect(processSessionTimeoutJob(mockJob, handleExpiredSessions)).rejects.toThrow(
      'Execution failed',
    );
  });
});

describe('createSessionTimeoutWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
  });

  it('creates a Worker with concurrency: 1', () => {
    createSessionTimeoutWorker({
      redis: buildMockRedis(),
      handleExpiredSessions: buildMockHandleExpiredSessions(),
    });

    const WorkerMock = vi.mocked(Worker);
    expect(WorkerMock).toHaveBeenCalledTimes(1);
    const [, , opts] = WorkerMock.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { concurrency: number },
    ];
    expect(opts.concurrency).toBe(1);
  });

  it('processor delegates to processSessionTimeoutJob', async () => {
    createSessionTimeoutWorker({
      redis: buildMockRedis(),
      handleExpiredSessions: buildMockHandleExpiredSessions(),
    });

    const WorkerMock = vi.mocked(Worker);
    const [, processor] = WorkerMock.mock.calls[0] as [
      unknown,
      (job: Job) => Promise<void>,
      unknown,
    ];

    const mockJob = { id: 'job-3', data: {} } as Job;
    await processor(mockJob);

    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('logs structured error on worker failed events', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const worker = createSessionTimeoutWorker({
      redis: buildMockRedis(),
      handleExpiredSessions: buildMockHandleExpiredSessions(),
    });

    const mockJob = { id: 'job-99', data: {} } as Job;
    const error = new Error('Redis connection lost');

    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      mockJob,
      error,
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith({
      msg: 'Session timeout worker failed permanently',
      jobId: 'job-99',
      data: {},
      error: 'Redis connection lost',
    });

    consoleError.mockRestore();
  });
});
