# Observability

Gastto uses [Pino](https://getpino.io/) as the single structured logger across all layers (ADR-013).

## Logger factory

```typescript
import { createLogger } from './infrastructure/logger';

const rootLogger = createLogger({
  level: 'info', // from LOG_LEVEL env var
  pretty: true, // pino-pretty in development, JSON in production
});
```

The factory lives at `src/infrastructure/logger.ts`. It creates a Pino logger instance configured with the given log level and optional pretty-print transport.

## Sensitive-data redaction

`src/infrastructure/observability/sensitiveData.ts` defines the shared sensitive-field policy used by both the root Pino logger and Fastify's request logger. Authorization headers, cookies, tokens, secrets, OAuth state, raw messages and webhook payloads, job data, and provider error bodies are replaced with `[REDACTED]` before logging. Error logs retain safe operational metadata such as endpoint, queue, job ID, HTTP status, and error code.

Sentry is initialized with the same module's `beforeSend` scrubber. It creates a bounded, cycle-safe copy of the event and redacts matching keys in request data, breadcrumbs, contexts, extras, tags, and exception metadata before transmission. The scrubber never throws, so error reporting cannot disrupt application error handling.

## Logger lifecycle

- **Bootstrap (`main.ts`)**: A single root logger is created via `createLogger()` at the top of `bootstrap()`. It is injected into all downstream components (workers, use cases, adapters) via constructor dependency injection.
- **Fastify HTTP layer**: Fastify creates its own Pino logger via its `logger` config option. Routes and middleware access it via `req.log` (per-request child logger).
- **Pre-bootstrap (`config/env.ts`)**: Before the root logger exists, pre-bootstrap errors use `process.stderr.write` with structured JSON. This is the only exception to Pino usage.

## Injection pattern

Logger is passed via constructor dependency injection (DI), matching the pattern used for all other dependencies (Redis, Queue, repositories, ports):

```typescript
import type { Logger } from 'pino';

class MyUseCase {
  constructor(private readonly deps: { ..., logger: Logger }) {}
}
```

- **Workers**: Logger is passed in the deps/opts object of the worker creator function.
- **Use cases**: Logger is added to the deps interface or constructor parameters.
- **Infrastructure adapters**: Logger is a constructor parameter.

## Log levels

Controlled by the `LOG_LEVEL` environment variable (defaults to `info`). Valid values: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

Use the appropriate level:

- `logger.info` — normal operational events (message sent, retry scheduled, message chunked)
- `logger.warn` — non-critical issues (OAuth reminder skipped due to state transition)
- `logger.error` — errors that need attention (failed to send message, API error, worker failed)
- `logger.fatal` — catastrophic failure (bootstrap crash)

## Structured logging convention

All log calls use structured objects, never raw strings:

```typescript
// ✅ Correct
logger.error({ msg: 'Failed to send message', userId, code: 'SEND_FAILED' });

// ❌ Avoid
logger.error('Failed to send message');
```

## Testing

Tests should not test Pino log formatting (see `docs/testing/guidelines.md:113`). Instead, inject a mock logger:

```typescript
const mockLogger = { error: vi.fn(), info: vi.fn() } as unknown as Logger;
// or
const mockLogger = {} as unknown as Logger;
```

Verify logger calls in worker/use case tests by asserting on the mock's method calls.
