// LAYER: Interfaces / Integration Tests
// Thin integration test for the refactored bootstrap orchestrator in src/main.ts.
// Verifies that the wiring between bootstrap modules still produces a working server.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { Env } from '../../../config/env.schema';
import type { FastifyInstance } from 'fastify';
import { createLogger } from '../../../infrastructure/logger';
import type { LoggerFactory, RegisterShutdownHandlers } from '../../../main';

const baseEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgres://localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379/0',
  MAPPING_CORRECTION_TTL_SECONDS: 1800,
  CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD: 0.6,
  HIGH_AMOUNT_THRESHOLD_MULTIPLIER: 10,
  EXPENSE_REVIEW_TIMEOUT_MINUTES: 10,
  EXPENSE_REVIEW_REMINDER_TIMEOUT_MINUTES: 10,
  OPENAI_API_KEY: 'sk-test-openai',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  WEBHOOK_BASE_URL: 'https://example.com',
  ENCRYPTION_KEY: 'a'.repeat(64),
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
};

let envOverrides: Partial<Env> = {};

vi.mock('@config/env', () => ({
  get env() {
    return { ...baseEnv, ...envOverrides };
  },
}));

const QueueMock = vi.fn();
const WorkerMock = vi.fn();
const RedisMock = vi.fn();
const PostgresMock = vi.fn();
const DrizzleMock = vi.fn();
const SentryInitMock = vi.fn();
const SentryCaptureMock = vi.fn();

vi.mock('bullmq', () => ({
  Queue: QueueMock,
  Worker: WorkerMock,
}));

vi.mock('ioredis', () => ({
  Redis: RedisMock,
}));

vi.mock('postgres', () => ({
  default: PostgresMock,
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: DrizzleMock,
}));

vi.mock('@sentry/node', () => ({
  init: SentryInitMock,
  captureException: SentryCaptureMock,
}));

const fetchMock = vi.fn();

function buildMocks(): void {
  QueueMock.mockImplementation(() => ({
    add: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }));

  WorkerMock.mockImplementation(() => ({
    opts: { concurrency: 1 },
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }));

  RedisMock.mockImplementation(() => ({
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  }));

  PostgresMock.mockImplementation(() => ({
    end: vi.fn().mockResolvedValue(undefined),
  }));

  DrizzleMock.mockReturnValue({});

  fetchMock.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ ok: true }),
  });
}

function buildEnv(): Env {
  return { ...baseEnv, ...envOverrides };
}

const silentLoggerFactory: LoggerFactory = () => createLogger({ level: 'silent', pretty: false });

describe('bootstrap', () => {
  let bootstrap: (env: Env, loggerFactory: LoggerFactory) => Promise<FastifyInstance>;
  let registerShutdownHandlers: RegisterShutdownHandlers;
  let signalRegistrationsOnImport: string[] = [];
  let apps: FastifyInstance[] = [];

  beforeAll(async () => {
    const processOnceSpy = vi.spyOn(process, 'once');
    const main = await import('../../../main.js');
    bootstrap = main.bootstrap;
    registerShutdownHandlers = main.registerShutdownHandlers;
    signalRegistrationsOnImport = processOnceSpy.mock.calls
      .map(([event]) => String(event))
      .filter((event) => event === 'SIGTERM' || event === 'SIGINT');
    processOnceSpy.mockRestore();
  });

  beforeEach(() => {
    apps = [];
    buildMocks();
    envOverrides = {};
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps = [];
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('starts Fastify and responds to /health', async () => {
    const app = await bootstrap(buildEnv(), silentLoggerFactory);
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { status: string; ts: string };
    expect(body.status).toBe('ok');
    expect(body.ts).toBeDefined();
  });

  it('does not install production signal handlers when imported by tests', () => {
    expect(signalRegistrationsOnImport).toEqual([]);
  });

  it('registers SIGTERM and SIGINT handlers with one shared shutdown operation', async () => {
    const app = await bootstrap(buildEnv(), silentLoggerFactory);
    apps.push(app);
    const closeSpy = vi.spyOn(app, 'close');
    const once = vi.fn<(signal: 'SIGTERM' | 'SIGINT', listener: () => void) => unknown>();
    const shutdown = registerShutdownHandlers(app, { once });

    expect(once.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGINT']);

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('logs a structured error when graceful shutdown fails', async () => {
    const errorLogger = vi.fn();
    const shutdown = registerShutdownHandlers(
      {
        close: vi.fn().mockRejectedValue(new Error('close failed')),
        log: {
          info: vi.fn(),
          error: errorLogger,
        },
      } as unknown as Pick<FastifyInstance, 'close' | 'log'>,
      { once: vi.fn() },
    );

    await shutdown('SIGTERM');

    expect(errorLogger).toHaveBeenCalledWith({
      msg: 'Graceful shutdown failed',
      endpoint: 'process',
      code: 'GRACEFUL_SHUTDOWN_FAILED',
      error: 'close failed',
    });
  });

  it('does not initialize DB/Redis/workers when DATABASE_URL and REDIS_URL are empty', async () => {
    envOverrides = { DATABASE_URL: '', REDIS_URL: '' };

    const app = await bootstrap(buildEnv(), silentLoggerFactory);
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(QueueMock).not.toHaveBeenCalled();
    expect(WorkerMock).not.toHaveBeenCalled();
    expect(RedisMock).not.toHaveBeenCalled();
    expect(PostgresMock).not.toHaveBeenCalled();
  });

  it('registers swagger documentation', async () => {
    const app = await bootstrap(buildEnv(), silentLoggerFactory);
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/documentation',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/\/documentation\//);
  });

  it('auto-registers Telegram webhook when WEBHOOK_BASE_URL is not localhost', async () => {
    const app = await bootstrap(buildEnv(), silentLoggerFactory);
    apps.push(app);

    const setWebhookCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/setWebhook'),
    );

    expect(setWebhookCalls.length).toBeGreaterThan(0);
  });

  it('skips Telegram webhook auto-registration when WEBHOOK_BASE_URL is localhost', async () => {
    envOverrides = { WEBHOOK_BASE_URL: 'http://localhost:3000' };

    const app = await bootstrap(buildEnv(), silentLoggerFactory);
    apps.push(app);

    const setWebhookCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/setWebhook'),
    );

    expect(setWebhookCalls).toHaveLength(0);
  });

  it('initializes Sentry when SENTRY_DSN is present', async () => {
    envOverrides = { SENTRY_DSN: 'https://sentry.example.com/1' };

    const app = await bootstrap(buildEnv(), silentLoggerFactory);
    apps.push(app);

    expect(SentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://sentry.example.com/1',
        environment: 'test',
      }),
    );

    const sentryOptions = SentryInitMock.mock.calls[0]?.[0] as {
      beforeSend: (event: { extra: Record<string, unknown> }) => { extra: Record<string, unknown> };
    };
    expect(
      sentryOptions.beforeSend({ extra: { accessToken: 'secret', safe: 'value' } }).extra,
    ).toEqual({
      accessToken: '[REDACTED]',
      safe: 'value',
    });
  });

  it('registers and invokes the root Redis error listener with redacted metadata', async () => {
    const app = await bootstrap(buildEnv(), silentLoggerFactory);
    apps.push(app);
    const redis = RedisMock.mock.results[0]?.value as {
      on: ReturnType<typeof vi.fn>;
    };
    const errorHandler = redis.on.mock.calls.find(([event]) => event === 'error')?.[1] as
      | ((error: Error) => void)
      | undefined;
    const loggerError = vi.spyOn(app.log, 'error');
    const error = Object.assign(
      new Error('Connection reset at rediss://default:do-not-log@redis.example:6379'),
      { code: 'ECONNRESET' },
    );

    expect(errorHandler).toBeDefined();
    errorHandler?.(error);

    expect(loggerError).toHaveBeenCalledOnce();
    expect(loggerError).toHaveBeenCalledWith({
      msg: 'Redis connection error',
      endpoint: 'redis',
      code: 'REDIS_CONNECTION_ERROR',
      error: 'Connection reset at [REDACTED]',
      causeCode: 'ECONNRESET',
    });
  });
});
