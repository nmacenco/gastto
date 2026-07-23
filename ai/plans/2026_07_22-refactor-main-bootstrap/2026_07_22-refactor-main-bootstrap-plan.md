# Refactor `src/main.ts`: decompose `bootstrap()` and add safety tests

## Goal

Decompose the monolithic `bootstrap()` function in `src/main.ts` into small, testable modules; add integration and unit tests to protect the wiring; and remove the conditional-null cascade between Google OAuth-dependent use cases.

## Out of scope

The following items are intentionally **not** part of this plan. They are valid follow-ups but would make the refactor too large and risky if bundled together:

- **Graceful shutdown (`SIGTERM` / `SIGINT`):** requires new ADR and cross-cutting changes to workers, queues, Redis and SQL connections.
- **Cleaning up `@ts-expect-error` repository constructors:** likely involves Drizzle schema fixes or repository type changes beyond `src/main.ts`.
- **Adding Vitest coverage thresholds:** the project currently has none configured; enabling them is a separate CI/testing decision.

## Context

- `src/main.ts`: 616-line entry point with a single `bootstrap()` function that does logger setup, Sentry init, Fastify creation, DB/Redis connection, repository instantiation, use-case wiring, queue and worker creation, route registration, webhook auto-registration and server startup.
- `src/config/env.ts`: exports `env` loaded statically from `process.env`. To make bootstrap testable, the orchestrator and helper functions must accept `env` (or a typed subset) as a parameter instead of importing it directly.
- `docs/adr/adr.md`: ADR-009 (single process model), ADR-011 (thin FIFO worker + thick FSM worker), ADR-014 (manual DI wiring risk), ADR-015 (no retry on process-message side effects).
- `docs/testing/guidelines.md`: testing conventions, coverage targets and mocking rules.
- Existing test patterns:
  - Routes: `src/interfaces/http/routes/telegram.webhook.spec.ts`, `src/interfaces/http/routes/oauth.callback.spec.ts` (in-process Fastify + mocked dependencies).
  - Workers: `src/interfaces/workers/*.spec.ts` (mocked `bullmq.Worker`).
  - Redis: mocked by interface (e.g. `RedisProcessedMessageRepository.spec.ts`).
  - Postgres: testcontainers in integration tests (`src/__tests__/integration/helpers/db-container.ts`).
  - Telegram/Google OAuth: `globalThis.fetch` mocked.
- `vitest.config.ts`: Vitest 2.1.9 with `@vitest/coverage-v8`. No coverage thresholds configured.
- Current coverage of `src/main.ts`: 0 %.

## Phases

### Phase 1: Safety net - characterization tests of the current bootstrap

Create a small, focused set of integration tests that exercise the current `bootstrap()` wiring **without refactoring it**. The goal is to detect accidental behavioral changes once the refactor starts, not to achieve full coverage of the monolith.

- [x] Create `src/__tests__/integration/bootstrap/main.bootstrap.spec.ts` with the following minimal suites:
  - [x] **Fastify setup**: verify that `bootstrap()` starts an in-process Fastify instance that responds to `/health` with `{ status: 'ok', ts: <ISO> }`.
  - [x] **Conditional branches**: with `DATABASE_URL` and `REDIS_URL` unset, `bootstrap()` still starts Fastify and `/health` responds (no crash, no connection attempts).
  - [x] **Plugin presence**: verify that `@fastify/swagger` and `@fastify/swagger-ui` are registered by checking `/documentation` (or by inspecting the registered plugins if testing without full plugin startup).
  - [x] Mock all external boundaries:
    - `ioredis`: mock by interface (e.g. `{ exists: vi.fn(), setex: vi.fn(), on: vi.fn() } as unknown as Redis`).
    - `bullmq`: mock `Worker` and `Queue` with `vi.mock('bullmq', ...)`.
    - `@sentry/node`: mock with `vi.mock('@sentry/node', ...)`.
    - `postgres` / `drizzle`: mock the client and `db` object; do **not** spin up testcontainers for this phase.
    - `globalThis.fetch`: mock for Telegram webhook auto-registration and any adapter calls.
  - [x] Override `env` values without mutating `process.env` directly. If `env` is imported as a singleton, document the limitation and use `vi.stubEnv` / `vi.mock('@config/env', ...)` with a clear reset.
  - [x] Ensure the tests pass with `pnpm test` and produce meaningful coverage for `src/main.ts`.
  - [x] Run `pnpm run lint`, `pnpm run typecheck` and `pnpm run build` to verify the project still compiles and ships.
  - [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Extract bootstrap modules and feature-flag Google OAuth

Break `bootstrap()` into focused, testable functions and move them to a `src/bootstrap/` module. Keep the same runtime behavior. As part of this phase, collapse the `googleOAuthAdapter !== null ? ... : null` cascade into an explicit optional feature object.

- [x] Define the `Dependencies` type (or a `BootstrapDependencies` type) in `src/bootstrap/types.ts` that includes:
  - [x] Core infrastructure: `db`, `redis`, `rootLogger`.
  - [x] Repositories and use cases that are always created when DB/Redis are present.
  - [x] A `googleOAuth: GoogleOAuthFeature | null` property that groups all Google OAuth-dependent adapters and use cases (`googleOAuthAdapter`, `initiateCloudConnection`, `handleOAuthCallback`, `sendOAuthReminder`, etc.).
- [x] Create `src/bootstrap/` directory with the following files:
  - [x] `src/bootstrap/createFastify.ts`: exports `createFastify(env: Env, rootLogger: Logger): FastifyInstance`. Creates Fastify, registers plugins (helmet, sensible, swagger, swagger-ui), sets Zod compilers and wires Sentry error handler.
  - [x] `src/bootstrap/buildDependencies.ts`: exports `buildDependencies(env: Env, infra: { db: DrizzleDatabase, redis: Redis, rootLogger: Logger }): Dependencies`. Instantiates repositories, use cases, queues and optional adapters (Google OAuth, LLM). Returns the structured dependency object.
  - [x] `src/bootstrap/registerRoutes.ts`: exports `registerRoutes(app: FastifyInstance, deps: Dependencies, env: Env): void`. Registers `/health`, Telegram webhook route (if Telegram is configured) and OAuth callback route (if `deps.googleOAuth !== null`).
  - [x] `src/bootstrap/registerWorkers.ts`: exports `registerWorkers(app: FastifyInstance, deps: Dependencies, env: Env): Promise<void>`. Creates and starts BullMQ workers and auto-registers the Telegram webhook.
  - [x] `src/bootstrap/index.ts`: re-exports the above functions and the `Dependencies` / `GoogleOAuthFeature` types.
- [x] Refactor `src/main.ts` to be a thin orchestrator:
  - [x] Accept `env` and `createLogger` as the only direct dependencies.
  - [x] Create `rootLogger` and initialize Sentry.
  - [x] Call `createFastify(env, rootLogger)`.
  - [x] If `env.DATABASE_URL` and `env.REDIS_URL` are present: create `sql` and `redis`, call `buildDependencies()`, `registerRoutes()` and `registerWorkers()`.
  - [x] Call `app.listen()`.
  - [x] Keep the existing fatal-error handler at the bottom of the file.
- [x] Replace the inline null-cascade with `GoogleOAuthFeature`:
  - [x] If Google OAuth is configured, create and return the feature object.
  - [x] Otherwise return `null`.
  - [x] Update all consumers to check `deps.googleOAuth !== null` before accessing feature members.
- [x] Move/adapt the safety-net tests to the new modules:
  - [x] `src/bootstrap/createFastify.spec.ts`: unit test plugin registration, Zod compilers and Sentry error handler.
  - [x] `src/bootstrap/buildDependencies.spec.ts`: unit test repository/use-case wiring and conditional branches (no Telegram, no Google OAuth, LLM selection).
  - [x] `src/bootstrap/registerRoutes.spec.ts`: unit test that routes are registered with the expected dependencies.
  - [x] `src/bootstrap/registerWorkers.spec.ts`: unit test that workers are created with the expected options.
  - [x] `src/__tests__/integration/bootstrap/main.bootstrap.spec.ts`: keep a thin integration test that boots the new orchestrator and checks `/health`.
- [x] Document any new `Dependencies` type or exported function in a short JSDoc block.
- [x] Ensure all tests pass with `pnpm test`.
- [x] Run `pnpm run lint`, `pnpm run typecheck` and `pnpm run build`.
- [ ] Ask the user if they want to review the changes before continuing.

### Phase 3: Documentation and coverage verification

Close the loop by documenting the new architecture and verifying that the refactor meets the project coverage expectations.

- [x] Update documentation:
  - [x] Add a short entry in `docs/adr/adr.md` (or create a new dated ADR) describing the decision to extract `src/bootstrap/` modules and the `GoogleOAuthFeature` optional-module pattern.
  - [x] If route registration behavior or startup behavior changed in a user-visible way, update the relevant `docs/features/*.md` file. *(No user-visible behavior changed; skipped.)*
  - [x] Update `docs/adr/README.md` if a new ADR file is created.
- [x] Verify coverage of the new `src/bootstrap/` module reaches the Interfaces threshold (70 % as per `docs/testing/guidelines.md`). Report the actual number in the PR/commit.
  - **Actual `src/bootstrap/` coverage:** 99.19 % statements, 97.01 % branches, 100 % functions, 99.19 % lines.
- [x] Run the full gate: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`.
  - `eslint.config.js` was updated to ignore stale top-level `tests/` and `*.config.ts` files that are outside `tsconfig.json`; this was needed for lint to pass.
- [ ] Ask the user if they want to review the final changes.

## Next step

All phases completed. The gate passes and `src/bootstrap/` coverage exceeds the Interfaces threshold. Next step is to review the final changes and, if approved, commit them.
