// LAYER: Config
// Environment variable validation schema (Zod).
// Separated from runtime parsing so tests can import the schema without
// triggering side-effects.

import { z } from 'zod';
import { FSM_STATES, type FsmState } from '../domain/entities/ConversationState';

const semanticRoutingModeSchema = z.enum(['off', 'shadow', 'enabled']);

const semanticRouterStateModesSchema = z
  .string()
  .default('')
  .transform(
    (raw, ctx): Readonly<Partial<Record<FsmState, z.infer<typeof semanticRoutingModeSchema>>>> => {
      if (raw.trim() === '') return {};

      const modes: Partial<Record<FsmState, z.infer<typeof semanticRoutingModeSchema>>> = {};
      for (const entry of raw.split(',')) {
        const parts = entry.split('=');
        if (parts.length !== 2) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected STATE=mode entries' });
          return z.NEVER;
        }
        const [rawState, rawMode] = parts;
        const state = z.enum(FSM_STATES).safeParse(rawState?.trim());
        const mode = semanticRoutingModeSchema.safeParse(rawMode?.trim());
        if (!state.success || !mode.success || Object.hasOwn(modes, rawState!.trim())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'State modes must use unique known states and supported modes',
          });
          return z.NEVER;
        }
        modes[state.data] = mode.data;
      }
      return modes;
    },
  );

export const envSchema = z.object({
  // ── Runtime ─────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // ── Database ────────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // ── Cache / Queue ─────────────────────────────────────────────────────────────
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // ── Mapping correction state (HU-4.06) ─────────────────────────────────────────
  // TTL for the transient Redis-backed correction state. Default: 30 minutes.
  MAPPING_CORRECTION_TTL_SECONDS: z.coerce.number().default(1800),

  // ── Category classification (E1-US-04) ──────────────────────────────────────────
  // Minimum confidence (matched keywords / total tokens) for a keyword-based
  // category classification to be considered high-confidence.
  CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),

  // ── Expense review (E1-US-06) ─────────────────────────────────────────────────
  // Multiplier over the user's historical average expense amount above which an
  // amount is considered unusually high and requires explicit confirmation.
  HIGH_AMOUNT_THRESHOLD_MULTIPLIER: z.coerce.number().min(1).default(10),

  // Initial review timeout before the one-time reminder is sent.
  EXPENSE_REVIEW_TIMEOUT_MINUTES: z.coerce.number().min(1).default(10),

  // Additional timeout after the reminder before the review is auto-cancelled.
  EXPENSE_REVIEW_REMINDER_TIMEOUT_MINUTES: z.coerce.number().min(1).default(10),

  // ── LLM ───────────────────────────────────────────────────────────────────────
  // At least one provider key must be configured at runtime (checked in main.ts).
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),

  // Semantic routing is off unless states, cohort and sampling are explicitly enabled.
  SEMANTIC_ROUTER_STATE_MODES: semanticRouterStateModesSchema,
  SEMANTIC_ROUTER_COHORT_PERCENT: z.coerce.number().int().min(0).max(100).default(0),
  SEMANTIC_ROUTER_SHADOW_SAMPLE_PERCENT: z.coerce.number().int().min(0).max(100).default(0),
  SEMANTIC_ROUTER_COHORT_SEED: z
    .string()
    .regex(/^[a-zA-Z0-9._-]{1,64}$/)
    .default('gastto-semantic-router-v1'),
  SEMANTIC_ROUTER_PROVIDER: z.literal('openai').default('openai'),
  SEMANTIC_ROUTER_MODEL: z
    .enum(['gpt-4o-mini-2024-07-18', 'gpt-4o-2024-08-06', 'gpt-4o-2024-11-20'])
    .default('gpt-4o-mini-2024-07-18'),
  SEMANTIC_ROUTER_TIMEOUT_MS: z.coerce.number().int().min(1).max(29_000).default(10_000),
  SEMANTIC_ROUTER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4096).default(256),

  // ── Messaging ─────────────────────────────────────────────────────────────────
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1, 'TELEGRAM_WEBHOOK_SECRET is required'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  // Base URL where the Telegram webhook is reachable (e.g. https://gastto-develop.fly.dev).
  // Used to auto-register the webhook with Telegram Bot API on startup.
  WEBHOOK_BASE_URL: z.string().min(1, 'WEBHOOK_BASE_URL is required'),

  // ── Observability ─────────────────────────────────────────────────────────────
  SENTRY_DSN: z.string().optional(),

  // ── OAuth ─────────────────────────────────────────────────────────────────────
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_REDIRECT_URI: z.string().min(1, 'GOOGLE_REDIRECT_URI is required'),

  // ── Security ──────────────────────────────────────────────────────────────────
  // AES-256-GCM key for OAuth token encryption (ADR-007). Must be 32 bytes (64 hex chars).
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required'),
});

export type Env = z.infer<typeof envSchema>;
