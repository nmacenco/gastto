# Migrate from `console.*` to Pino Structured Logger

## Goal

Replace all 22 raw `console.*` calls across the codebase with a shared Pino logger instance injected via constructor dependency injection, so every layer (workers, use cases, adapters, bootstrap) emits structured JSON logs consistent with the Fastify HTTP layer.

## Context

### Current state

- **Fastify HTTP layer** (`app.log`, `req.log`) already uses Pino — no changes needed there.
- **Everything else** uses raw `console.log` / `console.error` / `console.warn` (22 calls across 9 files).
- No shared logger module exists. No logger is passed via DI to any use case, worker, or adapter.

### Files with `console.*` calls to migrate

| File                                                                                              | Count | Call types                           |
| ------------------------------------------------------------------------------------------------- | ----- | ------------------------------------ |
| `src/config/env.ts:15`                                                                            | 1     | `console.error` (raw string)         |
| `src/main.ts:392`                                                                                 | 1     | `console.error` (raw string)         |
| `src/interfaces/workers/incomingMessage.worker.ts:50`                                             | 1     | `console.error`                      |
| `src/interfaces/workers/message.worker.ts:169`                                                    | 1     | `console.error`                      |
| `src/interfaces/workers/sessionTimeout.worker.ts:33`                                              | 1     | `console.error`                      |
| `src/interfaces/workers/oauthReminder.worker.ts:40,65`                                            | 2     | `console.warn`, `console.error`      |
| `src/application/use-cases/spreadsheet/CancelCloudConnection.ts:61`                               | 1     | `console.error`                      |
| `src/application/use-cases/spreadsheet/HandleOAuthCallback.ts:127`                                | 1     | `console.error`                      |
| `src/application/use-cases/conversation/HandleExpiredSessions.ts:42,52`                           | 2     | `console.error`                      |
| `src/application/use-cases/conversation/RouteIncomingMessage.ts:65`                               | 1     | `console.error`                      |
| `src/infrastructure/adapters/telegram/TelegramMessengerAdapter.ts:72,106,116,130,141,153,164,175` | 8     | 7× `console.log`, 1× `console.error` |
| `src/infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter.ts:95,132`                     | 2     | `console.error`                      |

### Relevant documentation

- `docs/testing/guidelines.md` — line 113: "Do NOT test Pino log formatting". Tests should mock the logger, not inspect log output.
- `docs/adr/adr.md` — ADR-001 through ADR-011 define the architecture. No existing ADR covers logging/observability.
- `docs/adr/README.md` — ADR index to update after creating the new ADR.
- `docs/features/README.md` — feature doc index, update if a logging feature doc is created.
- `AGENTS.md` — Observability section: "Server-side errors: `console.error` with a structured object `{ endpoint, code, userId? }`". This guidance should be updated to reference Pino after migration.

### Design decisions

1. **Logger type**: Use Pino's `Logger` type directly (consistent with how the project uses `Redis` from ioredis, `Queue` from bullmq, etc.).
2. **Factory module**: `src/infrastructure/logger.ts` exports `createLogger(name: string, options?)` that returns a child Pino logger. The root logger is created once in `main.ts` and passed down.
3. **Injection pattern**: Constructor injection as optional parameter. Each class accepts `logger?: Logger`. If not provided, falls back to a silent/dummy logger or the root logger. In `main.ts`, a single root logger is created and injected into all downstream components.
4. **Bootstrap files**:
   - `config/env.ts`: Keep as `process.stderr.write` — no logger can exist before env vars are parsed (the logger needs `LOG_LEVEL` from env).
   - `main.ts:392` (bootstrap catch): Use the standalone logger from `createLogger()` with safe defaults (`info` level, no pretty).
5. **Reuse `LOG_LEVEL`**: Already defined in `src/config/env.schema.ts:12`. No new env vars required.
6. **Call semantics**: `console.log` → `logger.info`, `console.warn` → `logger.warn`, `console.error` → `logger.error`. Structured objects remain unchanged — they're already valid Pino payloads.

### Public contracts affected

- **Application services**: Constructor signatures change for 4 use cases (`CancelCloudConnection`, `HandleOAuthCallback`, `HandleExpiredSessions`, `RouteIncomingMessage`) and 2 adapters (`TelegramMessengerAdapter`, `GoogleDriveFileDiscoveryAdapter`).
- **Worker creators**: Function signatures change for 4 workers (`createIncomingMessageWorker`, `createMessageWorker`, `createSessionTimeoutWorker`, `createOAuthReminderWorker`).
- **Test suites**: Constructor/deps in `*.spec.ts` files for all modified files must pass a mock logger.
- **Database schemas**: No changes.
- **Domain events**: No changes.
- **Text copies**: No changes.

## Phases

### Phase 1: Foundation — Logger module, ADR, and bootstrap

**Description**: Create the shared Pino logger factory module and the ADR documenting the decision. Migrate the two bootstrap-level `console.*` calls (`config/env.ts` and `main.ts`). This establishes the foundation pattern that Phase 2 and Phase 3 build on.

**To-do actions**:

- [x] Create `src/infrastructure/logger.ts` — `createLogger(name, options?)` factory function that returns a `pino.Logger` instance. Accept `level` (from `LOG_LEVEL` env) and `pretty` (from `NODE_ENV !== 'production'`).
- [x] Write `docs/adr/2026-06-10-structured-logging.md` using the template at `docs/templates/adr.md`. Document the decision to use Pino as the single structured logger across all layers. Register it as ADR-013.
- [x] Update `docs/adr/README.md` — add ADR-013 entry to the index.
- [x] Migrate `src/config/env.ts:15` — replace `console.error(...)` with `process.stderr.write(JSON.stringify({ msg: 'Invalid environment variables', errors: parsed.error.flatten().fieldErrors }) + '\n')`. Logger cannot exist before env is parsed.
- [x] Migrate `src/main.ts:392` — create a standalone logger via the factory and call `logger.fatal(err, 'Fatal error during bootstrap')` instead of `console.error(...)`.
- [x] Update `AGENTS.md` Observability section — replace `console.error` guidance with Pino logger guidance.
- [x] Run `pnpm run lint && pnpm run typecheck` to verify. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Workers — BullMQ worker layer

**Description**: Inject Pino logger into all 4 BullMQ worker files and wire them in `main.ts`. Replace all `console.error` / `console.warn` calls in workers with structured Pino calls.

**To-do actions**:

- [x] Update `src/interfaces/workers/incomingMessage.worker.ts`:
  - Add `logger: pino.Logger` to the `createIncomingMessageWorker` opts.
  - Replace `console.error(...)` in the `'failed'` handler with `opts.logger.error(...)`.
  - Update type imports.
- [x] Update `src/interfaces/workers/message.worker.ts`:
  - Add `logger: pino.Logger` to `MessageWorkerDeps`.
  - Replace `console.error(...)` in the `'failed'` handler with `opts.logger.error(...)`.
  - Update type imports.
- [x] Update `src/interfaces/workers/sessionTimeout.worker.ts`:
  - Add `logger: pino.Logger` to `SessionTimeoutWorkerOpts`.
  - Replace `console.error(...)` in the `'failed'` handler with `opts.logger.error(...)`.
  - Update type imports.
- [x] Update `src/interfaces/workers/oauthReminder.worker.ts`:
  - Add `logger: pino.Logger` to `OAuthReminderWorkerDeps`.
  - Replace `console.warn(...)` in the `InvalidStateTransitionError` catch with `deps.logger.warn(...)`.
  - Replace `console.error(...)` in the `'failed'` handler with `deps.logger.error(...)`.
  - Update type imports.
- [x] Wire logger in `src/main.ts`: create root logger via `createLogger`, inject it into all 4 `create*Worker()` calls.
- [x] Update corresponding `*.spec.ts` files (`incomingMessage.worker.spec.ts`, `message.worker.spec.ts`, `sessionTimeout.worker.spec.ts`, `oauthReminder.worker.spec.ts`): pass a mock logger (e.g., `{} as unknown as pino.Logger` or use `vi.fn()`) in the deps.
- [x] Run `pnpm run lint && pnpm run typecheck` to verify. Fix issues if any.
- [x] Run `pnpm test` to verify all tests pass. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Use cases, adapters, and documentation

**Description**: Inject Pino logger into all 4 application use cases and 2 infrastructure adapters. Wire them in `main.ts`. Create/update feature documentation. Final cleanup.

**To-do actions**:

- [x] Update `src/application/use-cases/spreadsheet/CancelCloudConnection.ts`:
  - Add `logger: pino.Logger` to `CancelCloudConnectionDeps`.
  - Replace `console.error(...)` with `this.deps.logger.error(...)`.
  - Update type imports.
- [x] Update `src/application/use-cases/spreadsheet/HandleOAuthCallback.ts`:
  - Add `logger: pino.Logger` to the deps interface (read the file to find the exact interface name).
  - Replace `console.error(...)` with the injected logger call.
  - Update type imports.
- [x] Update `src/application/use-cases/conversation/HandleExpiredSessions.ts`:
  - Add `logger: pino.Logger` as constructor parameter (this class takes positional params, not a deps object — adapt accordingly).
  - Replace both `console.error(...)` calls with `this.logger.error(...)`.
  - Update type imports.
- [x] Update `src/application/use-cases/conversation/RouteIncomingMessage.ts`:
  - Add `logger: pino.Logger` to `RouteIncomingMessageDeps`.
  - Replace `console.error(...)` with `this.deps.logger.error(...)`.
  - Update type imports.
- [x] Update `src/infrastructure/adapters/telegram/TelegramMessengerAdapter.ts`:
  - Add `logger: pino.Logger` as constructor parameter (currently only takes `botToken`).
  - Replace all 7 `console.log(...)` calls with `this.logger.info(...)`.
  - Replace 1 `console.error(...)` call with `this.logger.error(...)`.
  - Update type imports.
- [x] Update `src/infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter.ts`:
  - Add `logger: pino.Logger` as constructor parameter (currently takes no params).
  - Replace both `console.error(...)` calls with `this.logger.error(...)`.
  - Update type imports.
- [x] Wire logger in `src/main.ts`: inject the root logger into all 4 use case constructors, 2 adapter constructors, and their deps.
- [x] Create `docs/architecture/observability.md` — brief documentation on the logging approach: Pino structured JSON, log levels, factory usage, per-layer injection pattern. Link from `docs/features/README.md`.
- [x] Update `docs/features/README.md` — add observability/logging entry to the index.
- [x] Update all corresponding `*.spec.ts` files (at least 6 files: `CancelCloudConnection.spec.ts`, `HandleOAuthCallback.spec.ts`, `HandleExpiredSessions.spec.ts`, `RouteIncomingMessage.spec.ts`, `TelegramMessengerAdapter.spec.ts`, `GoogleDriveFileDiscoveryAdapter.spec.ts`): pass a mock logger in constructor/deps calls.
- [x] Run `pnpm run lint && pnpm run typecheck` to verify. Fix issues if any.
- [x] Run `pnpm test` to verify all tests pass. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases completed. The migration from `console.*` to Pino structured logging is done across all layers.

Suggest exporting this conversation as `ai/plans/2026-06-10-migrate-to-pino-logger/2026-06-10-migrate-to-pino-logger-conversation.md` for traceability.
