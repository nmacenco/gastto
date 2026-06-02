// LAYER: Config
// Environment variable validation schema (Zod).
// Separated from runtime parsing so tests can import the schema without
// triggering side-effects.

import { z } from 'zod';

export const envSchema = z.object({
  // ── Runtime ─────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // ── Database ────────────────────────────────────────────────────────────────
  // Required once persistence is wired; optional during skeleton bootstrap.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').optional(),

  // ── Cache / Queue ─────────────────────────────────────────────────────────────
  // Required once BullMQ workers are wired; optional during skeleton bootstrap.
  REDIS_URL: z.string().min(1, 'REDIS_URL is required').optional(),

  // ── LLM ───────────────────────────────────────────────────────────────────────
  // Required once NLP extraction is wired; optional during skeleton bootstrap.
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required').optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // ── Messaging ─────────────────────────────────────────────────────────────────
  // Required once Telegram webhook is fully wired; optional during skeleton bootstrap.
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1, 'TELEGRAM_WEBHOOK_SECRET is required').optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required').optional(),

  // ── Observability ─────────────────────────────────────────────────────────────
  SENTRY_DSN: z.string().optional(),

  // ── Security ──────────────────────────────────────────────────────────────────
  // AES-256-GCM key for OAuth token encryption (ADR-007). Must be 32 bytes (64 hex chars).
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required'),
});

export type Env = z.infer<typeof envSchema>;
