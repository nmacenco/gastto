---
title: 'Configuration & Environment'
last_updated: '2026-11-08'
source_of_truth: ['src/config/env.schema.ts', '.env.example', 'compose.local.yml']
tags: ['architecture', 'config', 'env']
---

# Configuration & Environment

This document describes the configuration and environment setup for this project.

The release-evidence command accepts configuration only through explicit JSON file arguments. It intentionally has no environment-variable fallback, does not load `.env`, and cannot activate semantic routing. Runtime state modes, cohort percentages, sampling, model, timeout, and output-token cap remain the existing explicit server configuration and must be recorded separately in an approved rollout record.

## Environment variables

Telegram approval is opt-in with `ACCESS_APPROVAL_ENABLED=true`. When enabled, `ADMIN_NOTIFICATION_EMAIL`, `ADMIN_GMAIL_ADDRESS`, `ADMIN_GMAIL_CLIENT_ID`, `ADMIN_GMAIL_CLIENT_SECRET`, and `ADMIN_GMAIL_REFRESH_TOKEN` are required by startup validation. The Gmail credentials belong to an operator authorization with only `gmail.send`; store them in deployment secrets. The feature also uses the existing database, Redis, Telegram, Google OAuth, and token encryption settings. The production build includes `dist/interfaces/cli/approveAccessRequest.js` and `dist/interfaces/cli/notifyAccessRequest.js`.

| Variable                                       | Scope  | Required | Description                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------- |
| `NODE_ENV`                                     | Server | No       | Runtime environment: `development`, `production`, or `test`. Defaults to `development`.                                                                                                                                                                                                        |
| `PORT`                                         | Server | No       | HTTP server port. Defaults to `3000`.                                                                                                                                                                                                                                                          |
| `LOG_LEVEL`                                    | Server | No       | Pino log level. Defaults to `info`.                                                                                                                                                                                                                                                            |
| `DATABASE_URL`                                 | Server | Yes      | PostgreSQL connection string. Required at startup.                                                                                                                                                                                                                              |
| `REDIS_URL`                                    | Server | Yes      | Provider-independent Redis-compatible broker URI for BullMQ and caches. Hosted environments require TLS via `rediss://`.                                                                                                                                                                       |
| `OPENAI_API_KEY`                               | Server | No       | OpenAI API key. Optional; at least one LLM provider key is required.                                                                                                                                                                                                                           |
| `ANTHROPIC_API_KEY`                            | Server | No       | Anthropic API key. Optional.                                                                                                                                                                                                                                                                   |
| `NVIDIA_API_KEY`                               | Server | No       | NVIDIA API key for the `integrate.api.nvidia.com` OpenAI-compatible endpoint. Optional.                                                                                                                                                                                                        |
| `GROQ_API_KEY`                                 | Server | No       | Groq API key for its OpenAI-compatible endpoint. Keep separate from `OPENAI_API_KEY`. Optional.                                                                                                                                                                                                |
| `LLM_PROVIDER`                                 | Server | No       | Provider for the shared LLM port: `auto`, `nvidia`, `anthropic`, `openai`, or `groq`. Default `auto` retains NVIDIA → Anthropic → OpenAI precedence; Groq requires explicit selection in Phase 1. An explicit provider requires its API key. This is separate from `SEMANTIC_ROUTER_PROVIDER`. |
| `LLM_FALLBACK_PROVIDER`                        | Server | No       | Extraction backup: `auto`, `none`, `nvidia`, `anthropic`, `openai`, or `groq`. Default `auto` still prefers OpenAI then Anthropic then NVIDIA and does not select Groq in Phase 1. An explicit selection requires its key and must differ from the primary.                                    |
| `LLM_EXTRACTION_TIMEOUT_MS`                    | Server | No       | Extraction-only provider deadline in milliseconds, integer 1000–60000, default 30000. Includes response-body consumption; SDK extraction retries are disabled.                                                                                                                                 |
| `NVIDIA_MODEL`                                 | Server | No       | NVIDIA-only extraction/chat model ID. Defaults to `z-ai/glm-5.3-flash`; accepts a 1-128 character ID using letters, numbers, `.`, `_`, `-`, and `/`.                                                                                                                                           |
| `GROQ_MODEL`                                   | Server | No       | Groq-only model ID for extraction, correction, and chat. Defaults to `openai/gpt-oss-20b`; accepts the same model ID character pattern as `NVIDIA_MODEL`.                                                                                                                                      |
| `TELEGRAM_WEBHOOK_SECRET`                      | Server | Yes      | Secret token for Telegram webhook origin validation. Required at startup.                                                                                                                                                                                                           |
| `TELEGRAM_BOT_TOKEN`                           | Server | Yes      | Telegram Bot API token. Required at startup.                                                                                                                                                                                                                                  |
| `SENTRY_DSN`                                   | Server | No       | Sentry error tracking DSN. Optional.                                                                                                                                                                                                                                                           |
| `CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD` | Server | No       | Minimum confidence for keyword-based category classification (E1-US-04). Range: [0, 1]. Default: `0.6`.                                                                                                                                                                                        |
| `ENCRYPTION_KEY`                               | Server | Yes      | AES-256-GCM key for OAuth token encryption (ADR-007). Must be 32 bytes (64 hex chars). Required at startup.                                                                                                                                                                      |
| `SEMANTIC_ROUTER_STATE_MODES`                  | Server | No       | Strict comma-separated `FSM_STATE=off                                                                                                                                                                                                                                                          | shadow | enabled` map. Empty means every state is off. |
| `SEMANTIC_ROUTER_COHORT_PERCENT`               | Server | No       | Stable user-cohort percentage from 0 through 100. Defaults to `0`.                                                                                                                                                                                                                             |
| `SEMANTIC_ROUTER_SHADOW_SAMPLE_PERCENT`        | Server | No       | Stable per-message sampling percentage from 0 through 100. Defaults to `0`.                                                                                                                                                                                                                    |
| `SEMANTIC_ROUTER_COHORT_SEED`                  | Server | No       | Bounded non-secret identifier used for stable hashing. Never use a credential.                                                                                                                                                                                                                 |
| `SEMANTIC_ROUTER_PROVIDER`                     | Server | No       | Runtime router provider. Only the validated `openai` snapshot is currently supported.                                                                                                                                                                                                          |
| `SEMANTIC_ROUTER_MODEL`                        | Server | No       | Explicit supported runtime model snapshot; aliases are rejected.                                                                                                                                                                                                                               |
| `SEMANTIC_ROUTER_TIMEOUT_MS`                   | Server | No       | Router deadline from 1 through 29,000 ms, below the 30-second lock-renewal interval. Defaults to `10000`.                                                                                                                                                                                      |
| `SEMANTIC_ROUTER_MAX_OUTPUT_TOKENS`            | Server | No       | Structured router output cap from 64 through 4,096. Defaults to `256`.                                                                                                                                                                                                                         |

**Security note**: All secrets are server-side only. No env var is exposed to the client.

`NVIDIA_MODEL` is provider-specific and is used when NVIDIA is selected by
`LLM_PROVIDER` or by `auto` precedence. It does not
change the NVIDIA API key, endpoint, prompts, response parsing,
or provider precedence. Direct `NvidiaAdapter` construction also defaults to
`z-ai/glm-5.3-flash` when no model is supplied.

Groq uses `https://api.groq.com/openai/v1` and its own `GROQ_API_KEY`. An
operator may set `LLM_PROVIDER=groq` for the whole shared LLM port or
`LLM_FALLBACK_PROVIDER=groq` for initial expense extraction only. Merely setting
`GROQ_API_KEY` does not change either `auto` priority. The GPT-OSS extraction
request uses strict JSON Schema mode and existing local schema validation; a
valid JSON object alone does not establish valid expense fields. Development
currently selects Groq as primary and NVIDIA as extraction fallback. Functional
Telegram and spreadsheet validation passed on 2026-10-23; live fault injection
and production promotion remain separate decisions.

`LLM_PROVIDER` also selects the adapter for correction, column inference, and
other shared LLM-port calls. Set it explicitly to use another configured provider
while keeping `NVIDIA_API_KEY` available. The extraction-only fallback tries one
different configured provider after a typed provider/output failure. It gives the
primary half of `LLM_EXTRACTION_TIMEOUT_MS` and the backup the time remaining in
the original deadline; cancellation does not trigger it. If only one provider key
exists, `auto` has no backup. `none` disables fallback. This does not change
semantic routing. Validate both extraction and correction with the chosen provider
in development before promotion.

## Environment files

| File           | Committed       | Purpose                                                      |
| -------------- | --------------- | ------------------------------------------------------------ |
| `.env`         | No (gitignored) | Local development secrets. Never commit.                     |
| `.env.*`       | No (gitignored) | Other local environment files.                               |
| `.env.example` | Yes             | Template for local setup. Copy to `.env` and fill in values. |

## Local development and Compose inputs

The [local setup guide](../development/local-setup.md) documents the single
`docker compose -f compose.local.yml up --build` command. Compose uses a separate
`gastto-local` project and overrides these two application URLs:

| Client | PostgreSQL | Redis |
| --- | --- | --- |
| Containers in `compose.local.yml` | `postgres:5432` | `redis:6379` |
| Host tools with an explicit loopback port override | `localhost:<mapped-port>` | `localhost:<mapped-port>` only if separately published |

No hosted PostgreSQL or Redis project is needed for local development. The
Redis-only `docker-compose.yml` remains available to `pnpm redis:*`; it is a
separate workflow. Hosted Redis-compatible providers use `rediss://` when TLS is
required. Never copy a hosted `DATABASE_URL` or `REDIS_URL` into a local Compose
migration command.

The following variables control Compose rather than the application's Zod
schema:

| Variable | Local Compose purpose |
| --- | --- |
| `GASTTO_LOCAL_DB_PASSWORD` | URL-safe password used by the local PostgreSQL service and migration/app connection strings. Keep it stable while the named database volume exists; changing `.env` alone does not update the stored role password. |
| `COMPOSE_PROFILES` | `tunnel` starts ngrok by default; empty plus `compose.local.core.yml` starts only the core services. |
| `NGROK_AUTHTOKEN` | Private credential for the ngrok agent. The app container receives an empty override instead of this token. |

Application startup also requires `WEBHOOK_BASE_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, and `REDIS_URL`.
At least one LLM provider key must be configured. The default local tunnel uses
an HTTPS `WEBHOOK_BASE_URL` equal to the assigned ngrok development origin.
Use `http://localhost:3000` only for core-only runs, which skip Telegram webhook
registration. The Google callback is either
`http://localhost:3000/auth/google/callback` for a browser on the Docker host
or `https://<assigned-development-domain>/auth/google/callback` for a browser on
another device. `GOOGLE_REDIRECT_URI` must exactly match one authorized redirect
URI on the Google Web application client. `app:3000` is an internal Docker name,
not a browser redirect URI.

The ngrok agent forwards to `app:3000`; its readiness check confirms the
configured public endpoint before app startup. The app registers its Telegram
webhook before it listens, so external `/health`, `getWebhookInfo`, and a local
bot message must be checked after startup. The separate operator Gmail settings
are required only with `ACCESS_APPROVAL_ENABLED=true`.

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

### Extraction deadline and GLM request profile

`LLM_EXTRACTION_TIMEOUT_MS` applies to NVIDIA, OpenAI, and Claude `extractExpense` calls. It does not change the separate semantic-router timeout, correction/chat calls, queue wait, database queries, or message-delivery retries. Requests use an abort signal and SDK extraction calls explicitly disable automatic retries.

For the exact model `z-ai/glm-5.3-flash`, NVIDIA extraction sends `reasoning_effort: low` and `max_tokens: 4096` and consumes the SSE stream to collect final-answer content. Other model IDs keep the prior 512-token extraction budget, JSON response path, and no GLM-specific reasoning option. This is an explicit exception to model-only substitution: see [ADR-026](../adr/2026-09-23-bound-expense-extraction.md) and [ADR-027](../adr/2026-10-09-stream-nvidia-expense-extraction.md). Validate any overridden model against its provider contract and observe final-response metadata before changing its budget.

## HTTP security configuration

The runtime now targets Node 24. `TELEGRAM_WEBHOOK_SECRET` requires 32–256 Telegram-alphabet characters; `ENCRYPTION_KEY` requires exactly 64 hexadecimal characters. Optional budgets are `SECURITY_RATE_WINDOW_MS` (default 60000, range 1000–3600000), `SECURITY_TELEGRAM_LIMIT` and `SECURITY_OAUTH_LIMIT` (each default 60, range 1–10000). Inputs must be finite integers. See [security hardening](../features/security-hardening.md) for rotation and shared-peer limitations. Production Swagger UI is disabled. `pnpm security:audit` and `pnpm security:test` enforce the dependency evidence contract.

Builds pin pnpm 10.34.9. The production runtime contains Node and application dependencies, without package-manager CLIs; dependency installation belongs to build stages.

Security CI runs both `pnpm security:audit` (production) and `pnpm security:audit:all` (including build/test tools). Reports are sanitized and retained for 14 days; a registry or parser failure blocks the gate.
