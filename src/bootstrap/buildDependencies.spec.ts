// LAYER: Bootstrap / Unit Tests
// Tests for the dependency graph builder: wiring, conditional features and LLM selection.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { Queue } from 'bullmq';

import { buildDependencies } from './buildDependencies';
import { createLogger } from '../infrastructure/logger';
import type { Env } from '../config/env.schema';
import type { DrizzleDatabase } from './types';
import { OpenAIAdapter } from '../infrastructure/adapters/llm/OpenAIAdapter';
import { ClaudeAdapter } from '../infrastructure/adapters/llm/ClaudeAdapter';
import { NvidiaAdapter } from '../infrastructure/adapters/llm/NvidiaAdapter';

vi.mock('bullmq', () => ({
  Queue: vi.fn(),
  Worker: vi.fn(),
}));

const baseEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgres://localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379/0',
  MAPPING_CORRECTION_TTL_SECONDS: 1800,
  OPENAI_API_KEY: 'sk-test-openai',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  WEBHOOK_BASE_URL: 'https://example.com',
  ENCRYPTION_KEY: 'a'.repeat(64),
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
};

function buildInfra() {
  return {
    db: {} as DrizzleDatabase,
    redis: {
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue(undefined),
    } as unknown as Redis,
    rootLogger: createLogger({ level: 'silent' }),
  };
}

describe('buildDependencies', () => {
  beforeEach(() => {
    vi.mocked(Queue).mockImplementation(
      () =>
        ({
          add: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        }) as unknown as Queue,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('wires all core repositories and use cases when DB/Redis are present', () => {
    const deps = buildDependencies(baseEnv, buildInfra());

    expect(deps.userRepo).toBeDefined();
    expect(deps.conversationRepo).toBeDefined();
    expect(deps.tokenRepo).toBeDefined();
    expect(deps.resolveIdentity).toBeDefined();
    expect(deps.getConversationState).toBeDefined();
    expect(deps.transitionState).toBeDefined();
    expect(deps.recoverCorruptedState).toBeDefined();
    expect(deps.registerExpense).toBeDefined();
  });

  it('creates the required BullMQ queues', () => {
    buildDependencies(baseEnv, buildInfra());

    const queueNames = vi.mocked(Queue).mock.calls.map(([name]) => name);
    expect(queueNames).toContain('process-message');
    expect(queueNames).toContain('incoming-message');
    expect(queueNames).toContain('oauth-reminder');
  });

  it('creates the Telegram feature when Telegram is configured', () => {
    const deps = buildDependencies(baseEnv, buildInfra());

    expect(deps.telegram).not.toBeNull();
    expect(deps.telegram?.adapter).toBeDefined();
    expect(deps.telegram?.routeIncomingMessage).toBeDefined();
  });

  it('creates the Google OAuth feature when credentials are configured', () => {
    const deps = buildDependencies(baseEnv, buildInfra());

    expect(deps.googleOAuth).not.toBeNull();
    expect(deps.googleOAuth?.adapter).toBeDefined();
    expect(deps.googleOAuth?.handleOAuthCallback).toBeDefined();
    expect(deps.googleOAuth?.inferColumnMapping).toBeDefined();
  });

  it('returns null Telegram feature when Telegram is not configured', () => {
    const env: Env = {
      ...baseEnv,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_WEBHOOK_SECRET: '',
    };

    const deps = buildDependencies(env, buildInfra());

    expect(deps.telegram).toBeNull();
  });

  it('returns null Google OAuth feature when credentials are missing', () => {
    const env: Env = {
      ...baseEnv,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GOOGLE_REDIRECT_URI: '',
    };

    const deps = buildDependencies(env, buildInfra());

    expect(deps.telegram).not.toBeNull();
    expect(deps.googleOAuth).toBeNull();
  });

  it('selects NVIDIA when its API key is configured', () => {
    const env: Env = {
      ...baseEnv,
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      NVIDIA_API_KEY: 'nvidia-key',
    };

    const deps = buildDependencies(env, buildInfra());

    expect(deps.llmPort).toBeInstanceOf(NvidiaAdapter);
  });

  it('selects Claude when its API key is configured', () => {
    const env: Env = {
      ...baseEnv,
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: 'anthropic-key',
      NVIDIA_API_KEY: undefined,
    };

    const deps = buildDependencies(env, buildInfra());

    expect(deps.llmPort).toBeInstanceOf(ClaudeAdapter);
  });

  it('selects OpenAI when its API key is configured', () => {
    const env: Env = {
      ...baseEnv,
      OPENAI_API_KEY: 'openai-key',
      ANTHROPIC_API_KEY: undefined,
      NVIDIA_API_KEY: undefined,
    };

    const deps = buildDependencies(env, buildInfra());

    expect(deps.llmPort).toBeInstanceOf(OpenAIAdapter);
  });

  it('throws when no LLM provider is configured', () => {
    const env: Env = {
      ...baseEnv,
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      NVIDIA_API_KEY: undefined,
    };

    expect(() => buildDependencies(env, buildInfra())).toThrow(
      /At least one LLM provider API key must be configured/,
    );
  });
});
