// LAYER: Config
// Centralized environment variable validation via Zod.
// Loaded once at bootstrap; crashes early if required variables are missing or invalid.
//
// Rules:
// - Every process.env access must go through this file. No inline `process.env.FOO!` elsewhere.
// - Optional vars are typed with `undefined` (exactOptionalPropertyTypes: true).

import { z } from 'zod';

const envSchema = z.object({
  // ── Runtime ─────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // ── Database ────────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // ── Cache / Queue ─────────────────────────────────────────────────────────────
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // ── LLM ───────────────────────────────────────────────────────────────────────
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  ANTHROPIC_API_KEY: z.string().optional(),

  // ── Messaging ─────────────────────────────────────────────────────────────────
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1, 'TELEGRAM_WEBHOOK_SECRET is required'),

  // ── Observability ─────────────────────────────────────────────────────────────
  SENTRY_DSN: z.string().optional(),

  // ── Security ──────────────────────────────────────────────────────────────────
  // AES-256-GCM key for OAuth token encryption (ADR-007). Must be 32 bytes (64 hex chars).
  // ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY is required"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables — see errors above');
}

export const env = parsed.data;
export type Env = typeof env;
