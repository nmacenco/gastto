---
title: 'Configuration & Environment'
last_updated: '2026-09-22'
source_of_truth: ['src/config/env.schema.ts']
tags: ['architecture', 'config', 'env']
---

# Configuration & Environment

This document describes the configuration and environment setup for this project.

The release-evidence command accepts configuration only through explicit JSON file arguments. It intentionally has no environment-variable fallback, does not load `.env`, and cannot activate semantic routing. Runtime state modes, cohort percentages, sampling, model, timeout, and output-token cap remain the existing explicit server configuration and must be recorded separately in an approved rollout record.

## Environment variables

| Variable                                       | Scope  | Required | Description                                                                                                               |
| ---------------------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------- |
| `NODE_ENV`                                     | Server | No       | Runtime environment: `development`, `production`, or `test`. Defaults to `development`.                                   |
| `PORT`                                         | Server | No       | HTTP server port. Defaults to `3000`.                                                                                     |
| `LOG_LEVEL`                                    | Server | No       | Pino log level. Defaults to `info`.                                                                                       |
| `DATABASE_URL`                                 | Server | No       | PostgreSQL connection string. Required once persistence is wired.                                                         |
| `REDIS_URL`                                    | Server | No       | Provider-independent Redis-compatible broker URI for BullMQ and caches. Hosted environments require TLS via `rediss://`.  |
| `OPENAI_API_KEY`                               | Server | No       | OpenAI API key. Optional; at least one LLM provider key is required.                                                      |
| `ANTHROPIC_API_KEY`                            | Server | No       | Anthropic API key. Optional.                                                                                              |
| `NVIDIA_API_KEY`                               | Server | No       | NVIDIA API key for the `integrate.api.nvidia.com` OpenAI-compatible endpoint. Optional.                                   |
| `NVIDIA_MODEL`                                 | Server | No       | NVIDIA-only extraction/chat model ID. Defaults to `z-ai/glm-5.3-flash`; accepts a 1-128 character ID using letters, numbers, `.`, `_`, `-`, and `/`. |
| `TELEGRAM_WEBHOOK_SECRET`                      | Server | No       | Secret token for Telegram webhook origin validation. Required once webhook is wired.                                      |
| `TELEGRAM_BOT_TOKEN`                           | Server | No       | Telegram Bot API token. Required once the bot sends messages.                                                             |
| `SENTRY_DSN`                                   | Server | No       | Sentry error tracking DSN. Optional.                                                                                      |
| `CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD` | Server | No       | Minimum confidence for keyword-based category classification (E1-US-04). Range: [0, 1]. Default: `0.6`.                   |
| `ENCRYPTION_KEY`                               | Server | No       | AES-256-GCM key for OAuth token encryption (ADR-007). Must be 32 bytes (64 hex chars). Currently commented out in schema. |
| `SEMANTIC_ROUTER_STATE_MODES`                  | Server | No       | Strict comma-separated `FSM_STATE=off                                                                                     | shadow | enabled` map. Empty means every state is off. |
| `SEMANTIC_ROUTER_COHORT_PERCENT`               | Server | No       | Stable user-cohort percentage from 0 through 100. Defaults to `0`.                                                        |
| `SEMANTIC_ROUTER_SHADOW_SAMPLE_PERCENT`        | Server | No       | Stable per-message sampling percentage from 0 through 100. Defaults to `0`.                                               |
| `SEMANTIC_ROUTER_COHORT_SEED`                  | Server | No       | Bounded non-secret identifier used for stable hashing. Never use a credential.                                            |
| `SEMANTIC_ROUTER_PROVIDER`                     | Server | No       | Runtime router provider. Only the validated `openai` snapshot is currently supported.                                     |
| `SEMANTIC_ROUTER_MODEL`                        | Server | No       | Explicit supported runtime model snapshot; aliases are rejected.                                                          |
| `SEMANTIC_ROUTER_TIMEOUT_MS`                   | Server | No       | Router deadline from 1 through 29,000 ms, below the 30-second lock-renewal interval. Defaults to `10000`.                 |
| `SEMANTIC_ROUTER_MAX_OUTPUT_TOKENS`            | Server | No       | Structured router output cap from 64 through 4,096. Defaults to `256`.                                                    |

**Security note**: All secrets are server-side only. No env var is exposed to the client.

`NVIDIA_MODEL` is provider-specific and is read only when `NVIDIA_API_KEY` is
configured and NVIDIA has the highest provider-selection precedence. It does not
change the NVIDIA API key, endpoint, request contract, prompts, response parsing,
or provider precedence. Direct `NvidiaAdapter` construction also defaults to
`z-ai/glm-5.3-flash` when no model is supplied.

## Environment files

| File           | Committed       | Purpose                                                      |
| -------------- | --------------- | ------------------------------------------------------------ |
| `.env`         | No (gitignored) | Local development secrets. Never commit.                     |
| `.env.*`       | No (gitignored) | Other local environment files.                               |
| `.env.example` | Yes             | Template for local setup. Copy to `.env` and fill in values. |

## Local Development Examples

See [`docs/development/local-setup.md`](../development/local-setup.md) for the full step-by-step guide. Below are common local connection strings:

### PostgreSQL (Supabase)

| Source         | Example `DATABASE_URL`                                                |
| -------------- | --------------------------------------------------------------------- |
| Supabase (dev) | `postgresql://postgres:password@db.project.supabase.co:5432/postgres` |

### Redis-compatible broker

| Source                               | Example `REDIS_URL`                                |
| ------------------------------------ | -------------------------------------------------- |
| Docker Compose (recommended locally) | `redis://localhost:6379`                           |
| Managed TLS provider                 | `rediss://username:password@provider.example:6379` |

Use Docker Compose locally so restarts and tests cannot consume shared development
capacity or mutate deployed BullMQ state. The deployed development app uses an
isolated Aiven for Valkey service under ADR-021; production retains its separate
existing provider. Never reuse hosted credentials in local `.env` files.

The runtime accepts standard Redis-compatible commands through ioredis. Provider
URIs are secrets: store them only in the environment's secret manager, never in
repository files, logs, screenshots, or command history. A provider-branded TLS
scheme must be normalized to the ioredis-compatible `rediss://` scheme before it
is stored.

### Google OAuth Redirect URI

```
http://localhost:3000/auth/google/callback
```

This URI must be registered **exactly** in Google Cloud Console > APIs & Credentials > Authorized redirect URIs.

### Telegram Webhook

For local development, Telegram requires a public HTTPS URL. Use **ngrok**:

```bash
ngrok http 3000
# Then set: WEBHOOK_BASE_URL=https://abcd-123.ngrok.io
```

The app auto-detects `localhost` and skips webhook registration, so ngrok is required to receive messages.

## Hosted environment secrets (Fly.io)

Set secrets independently for each Fly app. Never commit development or production
credentials to source control, and never copy one environment's broker URI into
the other environment.

```bash
flyctl secrets set --app <fly-app> REDIS_URL=<tls-uri>
```

Prefer the Fly dashboard or another workflow that does not retain the URI in shell
history. Fly does not expose a secret's value after it is set, so retain the
previous provider URI in an approved password manager for rollback.

### NVIDIA model override

Set the model independently on each Fly app. These commands change only the
model setting; do not include `NVIDIA_API_KEY` in deployment documentation,
shell history, logs, screenshots, or commits.

```bash
flyctl secrets set --app gastto NVIDIA_MODEL=z-ai/glm-5.3-flash
flyctl secrets set --app gastto-develop NVIDIA_MODEL=z-ai/glm-5.3-flash
```

Use a validated provider model ID when rotating the model. Keep the existing
`NVIDIA_API_KEY` and the application endpoint
`https://integrate.api.nvidia.com/v1/chat/completions` unchanged. Apply and
verify each app separately; rollback is another `flyctl secrets set` using the
last known-good model ID. Never print secret values when checking deployment
configuration.

## Framework / build config

- **Framework**: Fastify (monolith modular, not microservices)
- **Build**: `tsup` outputs a single CJS file to `dist/main.js`
- **Config files**:
  - `tsup.config.ts` (if present): tsup build options
  - `tsconfig.json`: TypeScript compiler options, path aliases (`@config/*`, `@domain/*`, etc.)

## NPM scripts

| Script               | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `pnpm dev`           | Start development server with hot reload (tsx watch) |
| `pnpm build`         | Build for production (tsup -> dist/main.js)          |
| `pnpm start`         | Run production build                                 |
| `pnpm test`          | Run tests once (vitest)                              |
| `pnpm test:watch`    | Run tests in watch mode                              |
| `pnpm test:coverage` | Run tests with coverage report                       |
| `pnpm lint`          | Lint source files (eslint)                           |
| `pnpm lint:fix`      | Lint and fix issues                                  |
| `pnpm format`        | Format source files (prettier --write)               |
| `pnpm format:check`  | Check formatting (prettier --check)                  |
| `pnpm typecheck`     | TypeScript type check without emit                   |
| `pnpm db:generate`   | Generate Drizzle migration files                     |
| `pnpm db:migrate`    | Run pending migrations                               |
| `pnpm db:studio`     | Open Drizzle Studio                                  |

## Standalone semantic evaluator

`pnpm eval:semantic-router` defaults to offline fixtures and never loads dotenv or
application bootstrap. Explicit live mode uses only the caller-provided
`OPENAI_API_KEY` and requires model, provider, case, timeout and output-token limits
on the command line. It does not use the application's provider preference or
initialize DB/Redis clients. See [Semantic Router Evaluation](../features/semantic-router-evaluation.md)
for supported snapshots, bounds and optional live commands. Do not read environment
files or print key values to run evaluations.

## Runtime semantic routing modes

Runtime routing is independent from the extraction-provider preference and the
standalone evaluator. All states, cohorting, and sampling default off. `shadow`
may spend provider capacity but cannot change the deterministic route. `enabled`
can execute the delivered expense capability matrix in `IDLE`,
`EXPENSE_RECEIVING`, `EXPENSE_CLARIFYING`, `EXPENSE_REVIEW`, `EXPENSE_CORRECTING`,
and `EXPENSE_SAVING_RETRY`, plus bound file/sheet option selection. Retry proposals
are request-only and reconfiguration remains inside the existing Google recovery use
case. Every other configured state/action pair fails closed. Missing credentials or invalid/unsupported enabled settings produce
bounded guidance without extraction or mutation. Shadow provider failures retain
the deterministic path. Configuration alone does not authorize a cohort; the
evaluation and rollout gates in ADR-023 still apply.

Rollback requires changing the affected state modes to `off`. Queue payloads do
not carry a captured mode, so already queued jobs resolve the new setting after
lock acquisition and make no semantic call. No queue or database migration is
required. PostgreSQL/Redis integration exercises `enabled → shadow → off` with
already queued work and active review, retry, and undo-confirming payloads;
deterministic commands, source text, bindings, expiry, pending expenses, and financial
claims remain compatible.
