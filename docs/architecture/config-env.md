---
title: 'Configuration & Environment'
last_updated: '2026-05-17'
source_of_truth: ['src/config/env.schema.ts']
tags: ['architecture', 'config', 'env']
---

# Configuration & Environment

This document describes the configuration and environment setup for this project.

## Environment variables

| Variable                  | Scope  | Required | Description                                                                                                               |
| ------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | Server | No       | Runtime environment: `development`, `production`, or `test`. Defaults to `development`.                                   |
| `PORT`                    | Server | No       | HTTP server port. Defaults to `3000`.                                                                                     |
| `LOG_LEVEL`               | Server | No       | Pino log level. Defaults to `info`.                                                                                       |
| `DATABASE_URL`            | Server | No       | PostgreSQL connection string. Required once persistence is wired.                                                         |
| `REDIS_URL`               | Server | No       | Redis connection string. Required once BullMQ workers are wired.                                                          |
| `OPENAI_API_KEY`          | Server | No       | OpenAI API key. Required once NLP extraction is wired.                                                                    |
| `ANTHROPIC_API_KEY`       | Server | No       | Anthropic API key. Optional.                                                                                              |
| `TELEGRAM_WEBHOOK_SECRET` | Server | No       | Secret token for Telegram webhook origin validation. Required once webhook is wired.                                      |
| `TELEGRAM_BOT_TOKEN`      | Server | No       | Telegram Bot API token. Required once the bot sends messages.                                                             |
| `SENTRY_DSN`              | Server | No       | Sentry error tracking DSN. Optional.                                                                                      |
| `ENCRYPTION_KEY`          | Server | No       | AES-256-GCM key for OAuth token encryption (ADR-007). Must be 32 bytes (64 hex chars). Currently commented out in schema. |

**Security note**: All secrets are server-side only. No env var is exposed to the client.

## Environment files

| File           | Committed       | Purpose                                                      |
| -------------- | --------------- | ------------------------------------------------------------ |
| `.env`         | No (gitignored) | Local development secrets. Never commit.                     |
| `.env.*`       | No (gitignored) | Other local environment files.                               |
| `.env.example` | Yes             | Template for local setup. Copy to `.env` and fill in values. |

## Production secrets (Fly.io)

Set secrets via the Fly.io CLI. Never commit production credentials to source control.

```bash
flyctl secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<secret>
```

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
