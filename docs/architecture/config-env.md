---
title: 'Configuration & Environment'
last_updated: '2026-08-23'
source_of_truth: ['src/config/env.schema.ts']
tags: ['architecture', 'config', 'env']
---

# Configuration & Environment

This document describes the configuration and environment setup for this project.

## Environment variables

| Variable                                       | Scope  | Required | Description                                                                                                               |
| ---------------------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                     | Server | No       | Runtime environment: `development`, `production`, or `test`. Defaults to `development`.                                   |
| `PORT`                                         | Server | No       | HTTP server port. Defaults to `3000`.                                                                                     |
| `LOG_LEVEL`                                    | Server | No       | Pino log level. Defaults to `info`.                                                                                       |
| `DATABASE_URL`                                 | Server | No       | PostgreSQL connection string. Required once persistence is wired.                                                         |
| `REDIS_URL`                                    | Server | No       | Provider-independent Redis-compatible broker URI for BullMQ and caches. Hosted environments require TLS via `rediss://`.  |
| `OPENAI_API_KEY`                               | Server | No       | OpenAI API key. Optional; at least one LLM provider key is required.                                                      |
| `ANTHROPIC_API_KEY`                            | Server | No       | Anthropic API key. Optional.                                                                                              |
| `NVIDIA_API_KEY`                               | Server | No       | NVIDIA API key for the `integrate.api.nvidia.com` OpenAI-compatible endpoint. Optional.                                   |
| `TELEGRAM_WEBHOOK_SECRET`                      | Server | No       | Secret token for Telegram webhook origin validation. Required once webhook is wired.                                      |
| `TELEGRAM_BOT_TOKEN`                           | Server | No       | Telegram Bot API token. Required once the bot sends messages.                                                             |
| `SENTRY_DSN`                                   | Server | No       | Sentry error tracking DSN. Optional.                                                                                      |
| `CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD` | Server | No       | Minimum confidence for keyword-based category classification (E1-US-04). Range: [0, 1]. Default: `0.6`.                   |
| `ENCRYPTION_KEY`                               | Server | No       | AES-256-GCM key for OAuth token encryption (ADR-007). Must be 32 bytes (64 hex chars). Currently commented out in schema. |

**Security note**: All secrets are server-side only. No env var is exposed to the client.

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
