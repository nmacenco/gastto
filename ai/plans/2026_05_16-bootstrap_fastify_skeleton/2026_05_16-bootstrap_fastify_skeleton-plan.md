# Plan: Bootstrap Fastify project skeleton and core infrastructure

## Goal

Bootstrap the Fastify application skeleton with TypeScript compilation, Zod environment validation, Pino structured logging, Sentry error tracking, a health-check endpoint, and the Clean Architecture folder structure under `src/`. This establishes the runtime contract that all subsequent user stories will build upon.

## Context

- `docs/adr/adr.md`: ADR-001 (Clean Architecture layers), ADR-009 (Fastify persistent server on Fly.io).
- `src/main.ts`: Entry point. Already bootstraps Fastify, Pino logger, Sentry initialization, and `GET /health`. Missing Sentry error handler wiring into Fastify. Contains `null as any` placeholders that should be cleaned to comply with the no-explicit-any ESLint rule.
- `src/config/env.ts`: Zod schema that loads and validates environment variables. Already fails fast on invalid input.
- `package.json`: Contains required runtime and dev dependencies (Fastify, Pino, Sentry, Zod, Vitest, etc.).
- `tsconfig.json`: TypeScript configuration with strict mode and path aliases (`@domain/*`, `@application/*`, etc.).
- `eslint.config.js`: Project lint rules including `@typescript-eslint/no-explicit-any: error`.
- Existing folders under `src/`: `application/use-cases/`, `domain/entities/`, `domain/ports/`, `infrastructure/adapters/`, `infrastructure/db/`, `interfaces/http/routes/`, `interfaces/workers/`, `config/`.
- CA folders: `src/application/dtos/`, `src/application/services/`, `src/domain/value-objects/`, `src/infrastructure/redis/` already exist (empty).
- No test files or `vitest.config.ts` exist yet.

## Phases

### Phase 1: Harden core infrastructure and folder structure

**Description:** Wire Sentry into Fastify's error handler, clean bootstrap TODOs in `main.ts`, and ensure the server starts cleanly.

- [x] In `src/main.ts`, register a Fastify `onError` hook that captures exceptions with `Sentry.captureException`.
- [x] In `src/main.ts`, replace `null as any` placeholders with `@ts-expect-error` comments or annotate them so ESLint `no-explicit-any` passes, while preserving the TODO intent for future tasks.
- [x] Verify `src/config/env.ts` fails fast on invalid config (already implemented; confirm behavior by reviewing schema).
- [x] Run `pnpm lint` and `pnpm typecheck` from the project root. Fix any issues.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Add test harness and verification

**Description:** Add Vitest configuration and write minimal tests for the health-check route and environment validation to establish the testing baseline.

- [x] Create `vitest.config.ts` at the project root with Node.js environment and TypeScript path alias resolution matching `tsconfig.json`.
- [x] Confirm `vitest` and `@vitest/coverage-v8` are present in `devDependencies` (already listed in `package.json`).
- [x] Create `src/interfaces/http/routes/health.spec.ts` that spins up a Fastify instance, registers the health route, and asserts `GET /health` returns HTTP 200 with body containing `{ status: 'ok' }`.
- [x] Create `src/config/env.spec.ts` that verifies `envSchema` accepts a valid environment object, handles defaults, rejects invalid enum values, and allows optional infrastructure variables.
- [x] Run `pnpm test` to ensure all tests pass.
- [x] Run `pnpm lint` and `pnpm typecheck` from the project root. Fix any issues.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3 (follow-up): Relax env validation for pending features

**Description:** Make environment variables optional for infrastructure pieces not yet wired (database, Redis, LLM, Telegram webhook) so the app boots with minimal configuration.

- [x] In `src/config/env.schema.ts`, mark `DATABASE_URL`, `REDIS_URL`, `OPENAI_API_KEY`, and `TELEGRAM_WEBHOOK_SECRET` as optional.
- [x] In `src/main.ts`, guard database, Redis, BullMQ, and Telegram webhook initialization behind presence checks for their respective env vars.
- [x] Remove unused `OpenAIAdapter` import from `src/main.ts`.
- [x] Update `src/config/env.spec.ts` to assert missing optional vars are accepted.
- [x] Run `pnpm test`, `pnpm lint`, and `pnpm typecheck`. Fix any issues.

## Public contracts

- Test suites (new):
  - `src/interfaces/http/routes/health.spec.ts`
  - `src/config/env.spec.ts`
- Application services: no new services in this task.
- Database schemas: no changes.
- Domain events: no changes.

## Next step

All phases are complete. The Fastify skeleton boots with minimal env vars, is lint/type-clean, and has a working Vitest harness with baseline tests.
