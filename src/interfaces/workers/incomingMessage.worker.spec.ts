// LAYER: Interfaces / Tests
// Unit tests for the thin incoming-message worker.
// Verifies job deserialization, worker construction, and error handling
// without a real Redis connection.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { RouteIncomingMessage } from '../../application/use-cases/conversation/RouteIncomingMessage';
import type { IncomingMessageJobData } from '../../application/ports/IncomingMessageJob';
import type { NormalizedPayload } from '../../domain/ports/messaging';
import { processIncomingMessageJob, createIncomingMessageWorker } from './incomingMessage.worker';

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
const mockLoggerError = vi.fn();

function buildMockLogger(): Logger {
  return { error: mockLoggerError } as unknown as Logger;
}

function buildMockRouteIncomingMessage(): RouteIncomingMessage {
  return { execute: mockExecute } as unknown as RouteIncomingMessage;
}

function buildMockRedis(): Redis {
  return {} as unknown as Redis;
}

describe('processIncomingMessageJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
  });

  it('deserializes job data and calls routeIncomingMessage.execute', async () => {
    const jobData: IncomingMessageJobData = {
      messageType: 'TEXT',
      chatId: '123456789',
      userId: '999',
      text: 'Cafe con leche 850',
      timestamp: '2026-05-20T12:00:00.000Z',
      channel: 'telegram',
    };

    const mockJob = { data: jobData } as Job<IncomingMessageJobData>;

    await processIncomingMessageJob(mockJob, buildMockRouteIncomingMessage());

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const normalizedPayload = mockExecute.mock.calls[0]![0] as NormalizedPayload;
    expect(normalizedPayload).toMatchObject({
      messageType: 'TEXT',
      chatId: '123456789',
      userId: '999',
      text: 'Cafe con leche 850',
      channel: 'telegram',
    });
    expect(normalizedPayload.timestamp).toBeInstanceOf(Date);
    expect(normalizedPayload.timestamp.toISOString()).toBe('2026-05-20T12:00:00.000Z');
  });

  it('passes rawPayload through when present', async () => {
    const rawPayload = { extra: 'data' };
    const jobData: IncomingMessageJobData = {
      messageType: 'UNSUPPORTED',
      chatId: '123456789',
      timestamp: '2026-05-20T12:00:00.000Z',
      channel: 'telegram',
      rawPayload,
    };

    const mockJob = { data: jobData } as Job<IncomingMessageJobData>;

    await processIncomingMessageJob(mockJob, buildMockRouteIncomingMessage());

    const normalizedPayload = mockExecute.mock.calls[0]![0] as NormalizedPayload;
    expect(normalizedPayload.rawPayload).toEqual(rawPayload);
  });

  it('processes 3 rapid jobs in FIFO order', async () => {
    const texts = ['Cafe 850', 'Taxi 1200', 'Super 4500'];
    const jobs = texts.map(
      (text, index) =>
        ({
          data: {
            messageType: 'TEXT',
            chatId: '123',
            text,
            timestamp: `2026-05-20T12:0${index}:00.000Z`,
            channel: 'telegram',
          },
        }) as Job<IncomingMessageJobData>,
    );

    for (const job of jobs) {
      await processIncomingMessageJob(job, buildMockRouteIncomingMessage());
    }

    expect(mockExecute).toHaveBeenCalledTimes(3);
    texts.forEach((text, index) => {
      const normalizedPayload = mockExecute.mock.calls[index]![0] as NormalizedPayload;
      expect(normalizedPayload.text).toBe(text);
    });
  });

  it('throws when routeIncomingMessage.execute rejects (so BullMQ can catch it)', async () => {
    mockExecute.mockRejectedValue(new Error('Routing failed'));

    const jobData: IncomingMessageJobData = {
      messageType: 'UNSUPPORTED',
      chatId: '123456789',
      timestamp: '2026-05-20T12:00:00.000Z',
      channel: 'telegram',
    };

    const mockJob = { data: jobData, id: 'job-42' } as Job<IncomingMessageJobData>;

    await expect(
      processIncomingMessageJob(mockJob, buildMockRouteIncomingMessage()),
    ).rejects.toThrow('Routing failed');
  });
});

describe('createIncomingMessageWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
  });

  it('creates a Worker with concurrency: 1', () => {
    createIncomingMessageWorker({
      redis: buildMockRedis(),
      routeIncomingMessage: buildMockRouteIncomingMessage(),
      logger: buildMockLogger(),
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

  it('processor delegates to processIncomingMessageJob', async () => {
    createIncomingMessageWorker({
      redis: buildMockRedis(),
      routeIncomingMessage: buildMockRouteIncomingMessage(),
      logger: buildMockLogger(),
    });

    const WorkerMock = vi.mocked(Worker);
    const [, processor] = WorkerMock.mock.calls[0] as [
      unknown,
      (job: Job<IncomingMessageJobData>) => Promise<void>,
      unknown,
    ];

    const jobData: IncomingMessageJobData = {
      messageType: 'TEXT',
      chatId: '123',
      timestamp: '2026-05-20T12:00:00.000Z',
      channel: 'telegram',
    };
    const mockJob = { data: jobData } as Job<IncomingMessageJobData>;

    await processor(mockJob);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('logs structured error on worker failed events', () => {
    const mockLogger = buildMockLogger();

    const worker = createIncomingMessageWorker({
      redis: buildMockRedis(),
      routeIncomingMessage: buildMockRouteIncomingMessage(),
      logger: mockLogger,
    });

    const mockJob = { id: 'job-99', data: { messageType: 'TEXT' } } as Job<IncomingMessageJobData>;
    const error = new Error('Queue connection lost');

    // Simulate BullMQ emitting the 'failed' event
    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      mockJob,
      error,
    );

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith({
      msg: 'Incoming message worker failed permanently',
      jobId: 'job-99',
      data: { messageType: 'TEXT' },
      error: 'Queue connection lost',
    });
  });
});
