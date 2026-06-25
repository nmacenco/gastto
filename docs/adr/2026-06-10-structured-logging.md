# ADR-013: Adopt Pino as the Single Structured Logger

**Date**: 2026-06-10
**Status**: Accepted
**Deciders**: [Engineering]

## Context

The Fastify HTTP layer already uses Pino for structured logging (`app.log`, `req.log`). However, 22 raw `console.*` calls exist across 9 files outside the HTTP layer: BullMQ workers, application use cases, and infrastructure adapters. These ad-hoc console calls:

- Bypass structured logging, making log aggregation and search harder in production (Fly.io).
- Use two disjoint logging mechanisms (Pino for HTTP, `console.*` for everything else), creating inconsistency.
- Cannot be filtered by log level at runtime — `console.log` debug lines (e.g., Telegram message-sent events) always appear even in production.

The AGENTS.md Observability section already mandates structured objects for error logging (`{ endpoint, code, userId? }`). The data shape is Pino-ready; only the transport mechanism needs standardizing.

## Considered Options

1. **Do nothing** — Keep `console.*` alongside Fastify's Pino logger.
   - Pros: No code changes.
   - Cons: Inconsistent logging, no runtime log-level filtering for non-HTTP code, production debug noise from `console.log`.

2. **Create a shared Pino logger module and inject it via constructor DI** — Replace all `console.*` calls with injected Pino loggers.
   - Pros: Single logging mechanism, structured JSON everywhere, runtime log-level filtering, consistent with Fastify's approach, testable (mock the logger in unit tests).
   - Cons: Requires modifying 11 files + tests, adds a constructor parameter to several classes.

3. **Use a global/singleton logger** — Import a shared logger directly in each file without DI.
   - Pros: Minimal code changes (no constructor signatures change).
   - Cons: Harder to test (cannot mock per-instance), couples every file to a concrete logger implementation, violates the DI pattern already used for all other dependencies in the codebase.

## Decision

We chose **Option 2: Shared Pino logger module with constructor dependency injection**.

A lightweight factory module at `src/infrastructure/logger.ts` creates Pino logger instances. A single root logger is created in `main.ts` and injected into all downstream components (workers, use cases, adapters). Each component accepts `logger: pino.Logger` as an optional constructor parameter.

## Rationale

- **Consistency with existing patterns**: Every other dependency (Redis, Queue, repositories, messaging ports) is already injected via constructors. Adding a logger parameter follows the same convention.
- **Testability**: Unit tests can pass `{ info: vi.fn(), error: vi.fn() }` as a mock logger. The testing guidelines already specify "Do NOT test Pino log formatting" (`docs/testing/guidelines.md:113`).
- **No new env vars**: Reuses the existing `LOG_LEVEL` env variable already defined in `src/config/env.schema.ts:12`.
- **Pino is already a dependency**: `pino@^9.3.1` and `pino-pretty@^11.2.1` are already in `package.json` (used by Fastify).

## Consequences

### Positive

- Single structured logging mechanism across all layers — Pino JSON everywhere.
- Runtime log-level filtering (trace/debug/info/warn/error/fatal) via `LOG_LEVEL` env var.
- Production logs are consistent structured JSON, queryable in Fly.io log aggregation.
- Tests can inject silent or spy loggers without affecting real log output.
- `console.log` debug events (Telegram message-sent) become `logger.info` and are filtered by log level.

### Negative

- Constructor signatures change for 6 classes and 4 worker-creator functions, requiring test updates.
- `pino-pretty` dependency remains even though it's only used in development (already present, no new dependency).
- `config/env.ts` validation failure still uses `process.stderr.write` because no logger can exist before env vars are parsed.

## References

- `docs/testing/guidelines.md` — Line 113: "Do NOT test Pino log formatting"
- `AGENTS.md` — Observability section (updated by this ADR)
- `src/infrastructure/logger.ts` — Logger factory implementation
