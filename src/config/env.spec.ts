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
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    WEBHOOK_BASE_URL: 'https://example.com',
    ENCRYPTION_KEY: 'a'.repeat(64),
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
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

  it('accepts missing truly optional variables', () => {
    const withoutOptional = {
      ...validEnv,
    };
    // @ts-expect-error dynamically deleting for test
    delete withoutOptional.OPENAI_API_KEY;
    // @ts-expect-error dynamically deleting for test
    delete withoutOptional.ANTHROPIC_API_KEY;
    // @ts-expect-error dynamically deleting for test
    delete withoutOptional.NVIDIA_API_KEY;
    // @ts-expect-error dynamically deleting for test
    delete withoutOptional.SENTRY_DSN;
    const result = envSchema.safeParse(withoutOptional);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OPENAI_API_KEY).toBeUndefined();
      expect(result.data.ANTHROPIC_API_KEY).toBeUndefined();
      expect(result.data.NVIDIA_API_KEY).toBeUndefined();
      expect(result.data.SENTRY_DSN).toBeUndefined();
    }
  });

  it('rejects missing required variables', () => {
    const withoutRequired = {
      NODE_ENV: 'development',
      PORT: '3000',
      LOG_LEVEL: 'info',
      ENCRYPTION_KEY: 'a'.repeat(64),
    };
    const result = envSchema.safeParse(withoutRequired);
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors).toHaveProperty('DATABASE_URL');
      expect(fieldErrors).toHaveProperty('REDIS_URL');
      expect(fieldErrors).toHaveProperty('TELEGRAM_WEBHOOK_SECRET');
      expect(fieldErrors).toHaveProperty('TELEGRAM_BOT_TOKEN');
      expect(fieldErrors).toHaveProperty('WEBHOOK_BASE_URL');
      expect(fieldErrors).toHaveProperty('GOOGLE_CLIENT_ID');
      expect(fieldErrors).toHaveProperty('GOOGLE_CLIENT_SECRET');
      expect(fieldErrors).toHaveProperty('GOOGLE_REDIRECT_URI');
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
      NVIDIA_API_KEY: 'nvidia-test-key',
      SENTRY_DSN: 'https://sentry.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ANTHROPIC_API_KEY).toBe('sk-test-anthropic');
      expect(result.data.NVIDIA_API_KEY).toBe('nvidia-test-key');
      expect(result.data.SENTRY_DSN).toBe('https://sentry.example.com');
      expect(result.data.TELEGRAM_BOT_TOKEN).toBe('test-bot-token');
    }
  });

  it('accepts TELEGRAM_BOT_TOKEN when present', () => {
    const withToken = envSchema.safeParse({
      ...validEnv,
      TELEGRAM_BOT_TOKEN: 'test-bot-token',
    });
    expect(withToken.success).toBe(true);
    if (withToken.success) {
      expect(withToken.data.TELEGRAM_BOT_TOKEN).toBe('test-bot-token');
    }
  });

  it('rejects empty TELEGRAM_BOT_TOKEN', () => {
    const withoutToken = envSchema.safeParse({
      ...validEnv,
      TELEGRAM_BOT_TOKEN: '',
    });
    expect(withoutToken.success).toBe(false);
    if (!withoutToken.success) {
      expect(withoutToken.error.flatten().fieldErrors).toHaveProperty('TELEGRAM_BOT_TOKEN');
    }
  });

  it('defaults CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD to 0.6', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD).toBe(0.6);
    }
  });

  it('coerces CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD to a number', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD: '0.8',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD).toBe(0.8);
    }
  });

  it('rejects CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD outside [0, 1]', () => {
    const belowZero = envSchema.safeParse({
      ...validEnv,
      CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD: '-0.1',
    });
    expect(belowZero.success).toBe(false);

    const aboveOne = envSchema.safeParse({
      ...validEnv,
      CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD: '1.1',
    });
    expect(aboveOne.success).toBe(false);
  });

  it('defaults HIGH_AMOUNT_THRESHOLD_MULTIPLIER to 10', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.HIGH_AMOUNT_THRESHOLD_MULTIPLIER).toBe(10);
    }
  });

  it('coerces HIGH_AMOUNT_THRESHOLD_MULTIPLIER to a number and rejects values below 1', () => {
    const valid = envSchema.safeParse({
      ...validEnv,
      HIGH_AMOUNT_THRESHOLD_MULTIPLIER: '5',
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.HIGH_AMOUNT_THRESHOLD_MULTIPLIER).toBe(5);
    }

    const belowOne = envSchema.safeParse({
      ...validEnv,
      HIGH_AMOUNT_THRESHOLD_MULTIPLIER: '0.5',
    });
    expect(belowOne.success).toBe(false);
  });

  it('defaults review timeout constants', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.EXPENSE_REVIEW_TIMEOUT_MINUTES).toBe(10);
      expect(result.data.EXPENSE_REVIEW_REMINDER_TIMEOUT_MINUTES).toBe(10);
    }
  });

  it('coerces review timeout constants to numbers and rejects values below 1', () => {
    const valid = envSchema.safeParse({
      ...validEnv,
      EXPENSE_REVIEW_TIMEOUT_MINUTES: '15',
      EXPENSE_REVIEW_REMINDER_TIMEOUT_MINUTES: '20',
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.EXPENSE_REVIEW_TIMEOUT_MINUTES).toBe(15);
      expect(valid.data.EXPENSE_REVIEW_REMINDER_TIMEOUT_MINUTES).toBe(20);
    }

    const invalid = envSchema.safeParse({
      ...validEnv,
      EXPENSE_REVIEW_TIMEOUT_MINUTES: '0',
    });
    expect(invalid.success).toBe(false);
  });
});
