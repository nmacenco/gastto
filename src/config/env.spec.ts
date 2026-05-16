// LAYER: Config / Tests
// Contract tests for Zod environment schema validation.

import { describe, it, expect } from 'vitest';
import { envSchema } from './env.schema';

describe('envSchema', () => {
  const validEnv = {
    NODE_ENV: 'development',
    PORT: '3000',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgres://localhost:5432/gastto',
    REDIS_URL: 'redis://localhost:6379',
    OPENAI_API_KEY: 'sk-test-openai',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
  };

  it('accepts a valid environment object', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
      expect(result.data.PORT).toBe(3000);
      expect(result.data.LOG_LEVEL).toBe('info');
    }
  });

  it('accepts missing optional infrastructure variables', () => {
    const minimal = {
      NODE_ENV: 'development',
      PORT: '3000',
      LOG_LEVEL: 'info',
    };
    const result = envSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DATABASE_URL).toBeUndefined();
      expect(result.data.REDIS_URL).toBeUndefined();
      expect(result.data.OPENAI_API_KEY).toBeUndefined();
      expect(result.data.TELEGRAM_WEBHOOK_SECRET).toBeUndefined();
    }
  });

  it('rejects invalid NODE_ENV values', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      NODE_ENV: 'staging',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('NODE_ENV');
    }
  });

  it('rejects invalid LOG_LEVEL values', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      LOG_LEVEL: 'verbose',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('LOG_LEVEL');
    }
  });

  it('coerces PORT to a number', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      PORT: '8080',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(8080);
    }
  });

  it('accepts optional variables', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      ANTHROPIC_API_KEY: 'sk-test-anthropic',
      SENTRY_DSN: 'https://sentry.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ANTHROPIC_API_KEY).toBe('sk-test-anthropic');
      expect(result.data.SENTRY_DSN).toBe('https://sentry.example.com');
    }
  });
});
