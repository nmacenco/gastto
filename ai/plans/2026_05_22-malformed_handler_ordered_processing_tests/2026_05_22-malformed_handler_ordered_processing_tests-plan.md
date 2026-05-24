# Plan: Malformed Payload Handler, Ordered Processing, and Comprehensive Tests

## Goal

Move malformed payload logging to the Fastify route layer, guarantee FIFO per-user message ordering via a thin BullMQ worker, wire the existing thick expense-processing worker, and deliver comprehensive tests covering all four Gherkin acceptance criteria.

## Context

### Current State

- **`src/interfaces/http/routes/telegram.webhook.ts`**: Always returns HTTP 200 and delegates all payloads (including `MALFORMED`) to `RouteIncomingMessage.execute()`. It does not log malformed payloads at the route layer.
- **`src/application/use-cases/conversation/RouteIncomingMessage.ts`**: Routes `TEXT`, `UNSUPPORTED`, and `MALFORMED`. The `MALFORMED` branch uses `console.error` directly. For `TEXT`, it resolves identity, enqueues a `process-message` job, and sends an ack.
- **`src/main.ts`**: Creates the `process-message` BullMQ queue but never imports or starts the thick worker (`message.worker.ts`). The worker is orphaned.
- **`src/interfaces/workers/message.worker.ts`**: Existing thick worker for FSM/LLM/expense processing (`concurrency: 2`). Not wired into the bootstrap process.
- **Tests**: Scenarios 1-3 have unit tests. Scenario 4 (rapid succession / FIFO ordering) has no test coverage.
- **`docs/features/incoming-message-routing.md`**: Documents the current pipeline. Mentions malformed payload logging to stderr as a TODO.
- **ADR-005**: Defines the two-stage BullMQ pipeline. The current implementation is incomplete because the worker is not wired.

### Relevant Documentation

- `docs/plans/plan-conventions.md` - Plan structure and conventions.
- `docs/testing/guidelines.md` - Coverage targets, test placement, mocking rules.
- `docs/adr/ADR-005-bullmq-redis.md` - Existing BullMQ/Redis pipeline ADR.
- `docs/features/incoming-message-routing.md` - Feature documentation to update.
- `AGENTS.md` - Build commands, architecture layers, DB conventions, ship gates.

### Architectural Decision

Introduce a **three-stage pipeline**:

1. **Webhook (Fastify)**: Validates origin, parses payload, short-circuits `MALFORMED` (logs + 200) and `/start` (sync), enqueues everything else to `incoming-message`.
2. **Thin Worker (`incoming-message`, `concurrency: 1`)**: Guarantees FIFO per user. Deserializes the job and calls `RouteIncomingMessage.execute()`.
3. **Thick Worker (`process-message`, `concurrency: 2`)**: Existing FSM/LLM/expense processing. Now wired in `main.ts`.

This decouples ingestion from routing, ensures strict ordering, and allows independent scaling of ingestion and processing.

## Phases

### Phase 1: Malformed Payload Handler + Ordered Processing Guarantee

**Description:** Implement the Interfaces-layer malformed payload handler (T-0.02-05) and the thin FIFO worker with full pipeline wiring (T-0.02-06).

- [x] Create `src/application/ports/IncomingMessageJob.ts` with serializable `IncomingMessageJobData` type (mirrors `NormalizedPayload` with `timestamp: string`).
- [x] Create `src/interfaces/workers/incomingMessage.worker.ts`:
  - [x] Export `createIncomingMessageWorker(opts: { redis: Redis; routeIncomingMessage: RouteIncomingMessage }) => Worker<IncomingMessageJobData>`.
  - [x] Worker must have `concurrency: 1` to guarantee FIFO.
  - [x] In the processor: deserialize `timestamp` back to `Date`, build `NormalizedPayload`, call `routeIncomingMessage.execute()`.
  - [x] Handle processor errors with structured logging (`console.error`) so the worker does not crash.
- [x] Modify `src/interfaces/http/routes/telegram.webhook.ts`:
  - [x] Update `TelegramWebhookDeps` to inject `incomingMessageQueue: Queue<IncomingMessageJobData>` instead of `routeIncomingMessage`.
  - [x] In `handleTelegramWebhook`:
    - [x] After `parseTelegramPayload(req.body)`:
      - If `messageType === 'MALFORMED'`: call `req.log.error({ endpoint: '/webhook/telegram', code: 'MALFORMED_PAYLOAD', rawPayload: req.body })` and return `reply.status(200).send({ ok: true })`.
      - If `/start`: keep existing synchronous `HandleStartCommand` short-circuit.
      - Otherwise: enqueue `normalizedPayload` (with `timestamp` as ISO string) to `incomingMessageQueue` and return `reply.status(200).send({ ok: true })`.
- [x] Modify `src/application/use-cases/conversation/RouteIncomingMessage.ts`:
  - [x] Remove the `MALFORMED` branch and its `console.error` logging. The route now owns this concern.
  - [x] Keep `TEXT` and `UNSUPPORTED` branches unchanged.
- [x] Modify `src/main.ts`:
  - [x] Import `createIncomingMessageWorker` and `createMessageWorker`.
  - [x] Create `incoming-message` queue with same Redis connection and retry policy as `process-message`.
  - [x] Instantiate and start `createIncomingMessageWorker`.
  - [x] Instantiate and start `createMessageWorker` (wire existing thick worker for `process-message` jobs).
  - [x] Pass `incomingMessageQueue` to `registerTelegramWebhook`.
  - [x] Keep `process-message` queue creation and `RouteIncomingMessage` deps unchanged.
- [x] Create `src/interfaces/workers/incomingMessage.worker.spec.ts`:
  - [x] Mock `RouteIncomingMessage`.
  - [x] Assert that a mocked job is deserialized correctly and `execute()` is called.
  - [x] Assert that processor errors are caught and logged, not thrown.
- [x] Update `src/interfaces/http/routes/telegram.webhook.spec.ts`:
  - [x] Replace `routeIncomingMessage` mock with `incomingMessageQueue.add` mock.
  - [x] Add test: malformed payload -> `req.log.error` called with full raw payload, HTTP 200, queue not called.
  - [x] Update existing tests to assert `incomingMessageQueue.add` is called for TEXT/UNSUPPORTED payloads.
  - [x] Keep `/start` tests unchanged.
- [x] Update `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts`:
  - [x] Remove the `MALFORMED` test case (the branch no longer exists in the source).
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Comprehensive Tests (All 4 Gherkin Scenarios)

**Description:** Write and update tests to cover all four acceptance criteria scenarios (T-0.02-07).

- [x] In `telegram.webhook.spec.ts` (or a new integration test file):
  - [x] **Scenario 1**: Simulate valid text payload -> assert parser extracts correct fields, `incomingMessageQueue.add` is called with correct job data, route returns 200.
  - [x] **Scenario 2**: Simulate unsupported payload (photo) -> assert `incomingMessageQueue.add` is called, route returns 200. Add a test in the worker or RouteIncomingMessage layer asserting the friendly unsupported message copy is sent.
  - [x] **Scenario 3**: Simulate malformed payload -> assert `req.log.error` is called with full raw payload, route returns 200, no exception is thrown, queue is not called.
  - [x] **Scenario 4**: Simulate 3 rapid messages from the same `chat_id` -> assert they are enqueued to `incoming-message` in order, the thin worker processes them in FIFO order, and `RouteIncomingMessage.execute` is called 3 times in sequence.
- [x] Create/update tests for `RouteIncomingMessage` to cover TEXT routing (identity, enqueue to `process-message`, ack send) and UNSUPPORTED delegation, with negative assertions (e.g., no messaging call when enqueue fails).
- [x] Run `pnpm test` and ensure all tests pass.
- [x] Run `pnpm test:coverage` and verify the message routing module meets coverage targets (Interfaces 70%, Application 85%).
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: ADR + Feature Documentation

**Description:** Document the three-stage pipeline decision and update canonical feature docs.

- [x] Create `docs/adr/ADR-010-two-stage-pipeline.md` (or next available sequential number):
  - [x] **Context**: Need strict FIFO per user for rapid successive messages while keeping Telegram ack < 1s. The existing single-queue design with `concurrency: 2` violates ordering.
  - [x] **Options considered**:
    - Single `process-message` queue with `concurrency: 1` (rejected: blocks heavy LLM processing, hurting throughput).
    - Synchronous in-order processing in the Fastify handler (rejected: violates ack SLA if any handler is slow).
    - BullMQ Pro Groups (rejected: requires paid license, overkill for MVP).
    - **Two-queue pipeline with thin FIFO worker** (accepted): `incoming-message` (thin, `concurrency: 1`) + `process-message` (thick, `concurrency: 2`).
  - [x] **Decision**: Adopt the two-queue pipeline.
  - [x] **Rationale**: Decouples ingestion from routing; FIFO is guaranteed by the thin worker; thick worker can scale independently; aligns with Clean Architecture (worker delegates to Application use case).
  - [x] **Consequences**:
    - Positive: Strict FIFO, independent scaling, clear layer separation.
    - Negative: Slightly higher complexity (two queues); ack is sent asynchronously from the worker instead of synchronously from the webhook.
    - Scaling TODO: When volume grows, replace `concurrency: 1` with BullMQ Pro Groups or a partition strategy by `chat_id` hash.
  - [x] **References**: Link to ADR-005, `docs/features/incoming-message-routing.md`.
- [x] Update `docs/features/incoming-message-routing.md`:
  - [x] Document the three-stage pipeline (webhook -> thin worker -> thick worker).
  - [x] Document that `MALFORMED` payloads are handled at the route layer and logged via `req.log.error`.
  - [x] Document the FIFO guarantee (`concurrency: 1` on `incoming-message` worker).
  - [x] Update test checklist to mark Scenario 4 as covered.
  - [x] Update TODO list: mark malformed handler and rate-limiting/flood protection as done or partially done.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next Step

All phases complete. Review the full diff, commit the changes, and consider exporting this conversation as a `.md` file alongside the plan.
