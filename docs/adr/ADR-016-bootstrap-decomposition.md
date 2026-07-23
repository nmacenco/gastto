# ADR-016: Decompose `src/main.ts` Bootstrap into Optional Feature Bundles

**Date**: 2026-07-22
**Status**: Accepted
**Deciders**: Engineering Lead, Tech Lead

## Context

`src/main.ts` had grown into a 600-line `bootstrap()` function that created the logger, initialized Sentry, built Fastify, connected to PostgreSQL and Redis, instantiated every repository, every use case, every queue and worker, registered routes, and auto-registered the Telegram webhook. The function was the only place in the codebase where the full dependency graph was assembled, and it was the only place where optional infrastructure (Telegram bot, Google OAuth) was wired.

This monolithic wiring had three concrete problems:

1. **Untestable wiring**: `bootstrap()` imported `env` and concrete adapters directly, so it could not be started in tests without touching `process.env` or real network resources.
2. **Conditional-null cascade**: Google OAuth-dependent use cases were wired with repeated `adapter !== null ? new SomeUseCase(...) : null` expressions, making it easy to pass a `null` dependency into a use case by mistake.
3. **No characterization safety net**: Refactoring the file risked changing route registration order, worker startup, or webhook auto-registration behavior without any test to catch the drift.

## Considered Options

1. **Keep the monolith and add inline tests**
   - Pros: Minimal file movement; no new modules.
   - Cons: Tests would still need to mock the global `env` singleton and every concrete dependency; the null-cascade would remain; future refactors would still be risky.

2. **Extract bootstrap helpers but keep optional adapters as scattered `null` checks**
   - Pros: Smaller functions; some testability gain.
   - Cons: The null-cascade problem persists; callers must remember to check every optional dependency; new OAuth-dependent use cases will reintroduce the same pattern.

3. **Decompose `src/main.ts` into a `src/bootstrap/` module and group optional adapters into explicit feature bundles (`TelegramFeature`, `GoogleOAuthFeature`)**
   - Pros: Each bootstrap step is testable in isolation; optional features are created atomically and consumed as a unit; the entry point becomes a readable orchestrator; the null-cascade disappears.
   - Cons: Slightly more files and a new top-level folder; developers must open multiple files to trace the full wiring.

## Decision

We chose **Option 3**.

`src/main.ts` is now a thin orchestrator that:

1. Creates the root logger.
2. Initializes Sentry.
3. Builds the Fastify instance via `createFastify(env, rootLogger)`.
4. Connects to PostgreSQL and Redis when `DATABASE_URL` and `REDIS_URL` are present.
5. Calls `buildDependencies(env, { db, redis, rootLogger })` to assemble the full graph.
6. Calls `registerWorkers(app, deps, env)` and `registerRoutes(app, deps, env)`.
7. Starts listening on `env.PORT`.

The `src/bootstrap/` module contains:

- `createFastify.ts`: Fastify factory, plugin registration, Zod compilers, Swagger, Sentry error handler.
- `buildDependencies.ts`: repository/use-case wiring and the optional feature bundles.
- `registerRoutes.ts`: `/health`, `/webhook/telegram`, `/auth/google/callback` registration.
- `registerWorkers.ts`: BullMQ worker creation and Telegram webhook auto-registration.
- `types.ts`: `Dependencies`, `TelegramFeature`, `GoogleOAuthFeature`.
- `index.ts`: public re-exports.

### Optional feature bundles

Instead of scattering `null` checks, optional infrastructure is now created as a single object:

```typescript
export interface TelegramFeature {
  adapter: TelegramMessengerAdapter;
  handleStartCommand: HandleStartCommand;
  sendImmediateAcknowledgement: SendImmediateAcknowledgement;
  handleUnsupportedMessage: HandleUnsupportedMessage;
  classifyFreeTextExpenseIntent: ClassifyFreeTextExpenseIntent;
  sendExpenseGuidance: SendExpenseGuidance;
  processedMessageRepository: RedisProcessedMessageRepository;
  routeIncomingMessage: RouteIncomingMessage;
}

export interface GoogleOAuthFeature {
  adapter: GoogleDriveOAuthAdapter;
  initiateCloudConnection: InitiateCloudConnection;
  handleOAuthCallback: HandleOAuthCallback;
  sendOAuthReminder: SendOAuthReminder;
  cancelCloudConnection: CancelCloudConnection;
  driveFileDiscovery: GoogleDriveFileDiscoveryAdapter;
  sheetsAdapterFactory: GoogleSheetsAdapterFactory;
  categoryReaderFactory: SpreadsheetCategoryReaderFactory;
  handleSpreadsheetFileSelection: HandleSpreadsheetFileSelection;
  handleSheetSelection: HandleSheetSelection;
  validateSpreadsheetAccess: ValidateSpreadsheetAccess;
  inferColumnMapping: InferColumnMapping;
  confirmColumnMapping: ConfirmColumnMapping;
  correctColumnMapping: CorrectColumnMapping;
  detectCategories: DetectCategories;
  confirmCategories: ConfirmCategories;
}
```

The `Dependencies` graph exposes `telegram: TelegramFeature | null` and `googleOAuth: GoogleOAuthFeature | null`. Consumers check `deps.googleOAuth !== null` once and then access every member of the bundle safely. If a feature is absent, its routes and workers are skipped.

### Testability

`bootstrap(env, loggerFactory)` now accepts `env` and a logger factory, so tests can start the server without mutating `process.env`. Each bootstrap function has dedicated unit tests and a thin integration test in `src/__tests__/integration/bootstrap/main.bootstrap.spec.ts` guards the orchestrator end-to-end.

## Rationale

- The refactor preserves all runtime behavior: route set, worker startup order, webhook auto-registration, and conditional startup when DB/Redis are missing.
- Grouping optional adapters into feature objects removes the `null`-cascade and makes the dependency graph explicit.
- Small, focused modules are easier to unit test than a single 600-line function.
- The entry point now reads as a high-level sequence of steps rather than an implementation dump.

## Consequences

### Positive

+ Bootstrap wiring is now covered by unit and integration tests.
+ Optional infrastructure is expressed as whole features, not scattered `null` checks.
+ New OAuth-dependent use cases are added inside `GoogleOAuthFeature` and automatically flow to workers and routes.
+ The `src/main.ts` file shrank from ~600 lines to ~100 lines and documents the startup sequence.

### Negative

- The full dependency graph is split across several files; tracing a concrete dependency requires jumping between `buildDependencies.ts`, `types.ts`, and the relevant route/worker files.
- `buildDependencies.ts` remains large because the project uses manual dependency injection. A future DI container decision would require a separate ADR.

## References

- `src/main.ts`
- `src/bootstrap/`
- ADR-009: Use Persistent Node.js Server with Fastify
- ADR-011: Two-Queue Pipeline for FIFO Message Ordering
- ADR-014: Auto-trigger next use case on deterministic FSM transitions
