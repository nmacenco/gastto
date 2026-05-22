# ADR-010: Two-Queue Pipeline for FIFO Message Ordering

**Date**: 2026-05-22
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

ADR-005 introduced a two-stage asynchronous pipeline (webhook → `process-message` BullMQ worker) to satisfy the mutually exclusive constraints of **acknowledgment ≤ 1 second** and **LLM processing taking 2–5 seconds**. That pipeline is complete for decoupling, but it does not guarantee message ordering per user.

When a user sends multiple messages in rapid succession (e.g., correcting an expense before the bot responds), the existing single `process-message` queue with `concurrency: 2` can process them out of order. This violates conversational coherence: the bot might reply to the second message before the first, or apply a stale FSM state to a newer message.

We need strict **FIFO per user** while keeping the Telegram ack under 1s and without blocking heavy LLM processing.

## Considered Options

1. **Single `process-message` queue with `concurrency: 1`**
   - Pros: Simplest change; guarantees global FIFO.
   - Cons: Blocks heavy LLM processing for all users if any single job is slow. Hurts throughput under load. Rejected.

2. **Synchronous in-order processing in the Fastify handler**
   - Pros: No additional queues; easiest to reason about ordering.
   - Cons: Violates the ≤ 1s ack SLA if identity resolution or any downstream handler is slow. Rejected.

3. **BullMQ Pro Groups**
   - Pros: Native per-group FIFO with higher concurrency; industry-proven.
   - Cons: Requires paid BullMQ Pro license. Overkill for MVP stage. Rejected for now, noted as future upgrade path.

4. **Two-queue pipeline with thin FIFO worker**
   - Pros: Decouples ingestion from routing; FIFO guaranteed by thin worker (`concurrency: 1`); thick worker can scale independently; aligns with Clean Architecture (worker delegates to Application use case).
   - Cons: Slightly higher complexity (two queues, two workers); ack is sent asynchronously from the worker instead of synchronously from the webhook.
   - **Accepted**.

## Decision

Adopt a **three-stage pipeline**:

1. **Webhook (Fastify)** — Validates origin, parses payload, short-circuits `MALFORMED` (logs + 200) and `/start` (sync), enqueues everything else to `incoming-message`.
2. **Thin Worker (`incoming-message`)** — `concurrency: 1`. Guarantees FIFO per user. Deserializes the job and calls `RouteIncomingMessage.execute()`.
3. **Thick Worker (`process-message`)** — `concurrency: 2`. Existing FSM/LLM/expense processing from ADR-005.

This extends ADR-005 without replacing it; the `process-message` queue and worker remain unchanged.

### Pipeline Flow

```
Telegram Webhook
      │
      ▼
Fastify Handler ── MALFORMED? ──► req.log.error + 200 OK
      │
      ▼
/start? ──► HandleStartCommand (sync)
      │
      ▼
incoming-message Queue (BullMQ)
      │
      ▼
Thin Worker (concurrency: 1)
      │
      ▼
RouteIncomingMessage.execute()
      │
      ├── TEXT ──► resolve identity ──► process-message Queue ──► Thick Worker
      │                                           │
      │                                           ▼
      │                                    FSM → NLP → response
      │
      └── UNSUPPORTED ──► HandleUnsupportedMessage
```

### Job Data Contracts

- `IncomingMessageJobData` (Application layer, serializable):

  ```typescript
  {
    messageType: 'TEXT' | 'UNSUPPORTED' | 'MALFORMED';
    chatId: string;
    userId?: string;
    text?: string;
    timestamp: string;   // ISO-8601
    channel: 'telegram' | 'whatsapp';
    rawPayload?: unknown;
  }
  ```

- `ProcessMessageJobData` (existing from ADR-005):
  ```typescript
  {
    userId: string;
    rawMessage: string;
    channel: 'telegram' | 'whatsapp';
    externalId: string;
    receivedAt: string;
  }
  ```

### Retry Policy (shared across both queues)

| Parameter          | Configured Value          |
| ------------------ | ------------------------- |
| Max retries        | 3                         |
| Backoff            | Exponential: 1s → 2s → 4s |
| Remove on complete | 100                       |
| Remove on fail     | 500                       |

### Error Handling

- **Webhook layer**: `MALFORMED` payloads are logged via `req.log.error` with structured fields (`endpoint`, `code`, `rawPayload`) and return HTTP 200 to prevent Telegram retry loops.
- **Thin worker**: Processor errors are caught by BullMQ's built-in retry mechanism. Exhausted retries trigger the `failed` event, which logs a structured error (`msg`, `jobId`, `data`, `error`) to `console.error`.
- **Thick worker**: Unchanged from ADR-005.

## Rationale

- **Strict FIFO** is achieved by the thin worker's `concurrency: 1` without sacrificing the thick worker's ability to process multiple LLM requests in parallel.
- **Clean Architecture boundary** is preserved: the worker lives in the Interfaces layer and delegates to the Application layer's `RouteIncomingMessage` use case.
- **Ack SLA** is maintained because the Fastify handler only parses and enqueues; it never waits for the LLM.
- **Independent scaling**: If ingestion volume grows, the `incoming-message` queue can be scaled separately from `process-message`.

## Consequences

### Positive

- Strict FIFO per user guaranteed by thin worker.
- Thick worker can scale independently (`concurrency: 2` or higher).
- Clear layer separation: webhook (Interfaces) → router (Application) → FSM/NLP (Application + Infrastructure).
- Malformed payload logging moved to route layer where request context (`req.log`) is available.

### Negative

- Two queues and two workers add operational complexity.
- Acknowledgment message ("Recibido, procesando tu gasto…") is now sent asynchronously from the worker rather than synchronously from the webhook. This adds a small delay (< 100ms in practice) but stays well under the 1s SLA.
- `concurrency: 1` on the thin worker is a bottleneck if inbound message volume exceeds a few dozen messages per second. Mitigation: monitor queue depth and switch to BullMQ Pro Groups or a partition strategy by `chat_id` hash when needed.

## References

- [`docs/adr/ADR-005-bullmq-redis.md`](./ADR-005-bullmq-redis.md)
- [`docs/features/incoming-message-routing.md`](../features/incoming-message-routing.md)
- [`src/interfaces/workers/incomingMessage.worker.ts`](../../src/interfaces/workers/incomingMessage.worker.ts)
- [`src/interfaces/http/routes/telegram.webhook.ts`](../../src/interfaces/http/routes/telegram.webhook.ts)
