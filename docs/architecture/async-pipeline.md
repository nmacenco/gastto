# Async Pipeline — Gastto

> **Why this document exists:** The two-stage pipeline (ack < 300ms → processing < 5s) is the most counter-intuitive design decision for an agent that has not read ADR-005. Without this context, it is natural to generate code that calls the LLM inside the HTTP handler. This document prevents that.
> **Related:** [ADR-005 · Latencia: Pipeline Asíncrono con BullMQ sobre Redis](../adr/adr.md#adr-005--latencia-pipeline-asíncrono-con-bullmq-sobre-redis)

---

## Two-stage diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STAGE 1 — Immediate Acknowledge                     Target: < 300 ms        │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────┐    ┌─────────────────┐   │
│  │ Webhook     │───→│ Validate     │───→│ Enqueue │───→│ HTTP 200 +      │   │
│  │ (Telegram/  │    │ origin       │    │ job     │    │ "Recibido..."   │   │
│  │  WhatsApp)  │    │ (token/HMAC) │    │         │    │ to user         │   │
│  └─────────────┘    └──────────────┘    └─────────┘    └─────────────────┘   │
│                              │                                                │
│                              └─ NEVER calls LLM, spreadsheet, or heavy DB    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STAGE 2 — Async Processing                          Target: < 5 s total     │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────┐    ┌─────────────────┐   │
│  │ BullMQ      │───→│ FSM recovery │───→│ LLM     │───→│ Final response  │   │
│  │ worker      │    │ + NLP +      │    │ + save  │    │ to user         │   │
│  │ consumes    │    │ categorise   │    │         │    │ + state update  │   │
│  │ job         │    │              │    │         │    │                 │   │
│  └─────────────┘    └──────────────┘    └─────────┘    └─────────────────┘   │
│                              │                                                │
│                              └─ Retry on failure (see Retry policy)          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## What the Fastify handler does (and does NOT do)

### The handler DOES:

1. Receives the webhook payload from Telegram or WhatsApp Business API.
2. Validates the origin:
   - **Telegram:** checks `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`.
   - **WhatsApp:** verifies HMAC-SHA256 signature in `X-Hub-Signature-256` against `WHATSAPP_APP_SECRET`.
3. Extracts `(channel, externalId)` from the payload.
4. Resolves `userId` via the cached identity lookup (`(channel, externalId) → userId` in Redis).
5. Normalises the payload into a `ProcessMessageJob` payload.
6. Enqueues a BullMQ job of type `process-message`.
7. Sends an immediate acknowledgement message to the user: _"Recibido, procesando tu gasto…"_
8. Returns HTTP 200 to the messaging channel.

### The handler does NOT:

- ❌ Call the LLM.
- ❌ Read from or write to the spreadsheet.
- ❌ Query PostgreSQL beyond the lightweight identity cache lookup.
- ❌ Run any business logic that depends on the message content.
- ❌ Perform category mapping or validation.

If you are adding code to the Fastify route handler (`src/interfaces/http/routes/webhook.ts` or equivalent) and it does any of the above, it is in the wrong place.

---

## What the BullMQ worker does

The worker runs in the same persistent Node.js process as Fastify but in a separate BullMQ consumer thread.

### Runtime job trust boundary

Every worker validates `job.data` with an exported strict Zod schema before acquiring locks, resolving state, sending messages, or invoking use cases. Unknown fields, invalid enums, malformed timestamps, and non-empty session-timeout payloads fail with `INVALID_JOB_PAYLOAD`; logs retain only the queue, job ID, error code, and validation paths.

`process-message` and `oauth-reminder` jobs also resolve `(channel, externalId)` and require it to match the supplied `userId` before performing side effects. This prevents a validly-shaped queue payload from acting on another user's messaging identity.

1. Receives the `process-message` job payload.
2. Loads the user's current FSM state from PostgreSQL (`conversation_states`).
3. Runs the FSM transition logic to determine the next state and action.
4. If the state requires NLP:
   - Calls the LLM adapter (`LLMPort.extractExpense`).
   - Applies category mapping via the user's `MappingConfig`.
5. If the state requires spreadsheet interaction:
   - Calls the spreadsheet adapter (`SpreadsheetPort.appendRow` or equivalent).
   - Handles the three error types per [Error Taxonomy](./error-taxonomy.md).
6. Sends the final response to the user via the messaging adapter (`MessagingPort.sendMessage`).
7. Persists the new FSM state and any `state_payload` to PostgreSQL.
8. Persists timeout timestamps for the repeatable `session-timeout` scheduler to scan.

---

## Job types defined

| Job type           | Payload                                                                                     | Purpose                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `process-message`  | `{ userId, channel, externalId, rawMessage, externalMessageId, receivedAt, callbackData? }` | Main pipeline job. Triggered on every incoming message.                                                          |
| `incoming-message` | `{ messageType, chatId, timestamp, channel, externalMessageId, ... }`                       | FIFO ingress job. Strictly validated before normalization.                                                       |
| `oauth-reminder`   | `{ userId, externalId, channel }`                                                           | Delayed OAuth reminder. Requires identity binding validation.                                                    |
| `session-timeout`  | `{}`                                                                                        | Repeatable scheduler that scans persisted FSM sessions and advances expired states without inbound HTTP traffic. |
| `scheduled-alert`  | _(future)_                                                                                  | Reserved for Release 2 periodic alerts and automated summaries. Not implemented in MVP.                          |

---

## Retry policy

All job types share the same BullMQ retry configuration:

| Parameter               | Value                                                          |
| ----------------------- | -------------------------------------------------------------- |
| Maximum retries         | 3                                                              |
| Backoff strategy        | Exponential                                                    |
| Backoff delays          | 1 s → 2 s → 4 s                                                |
| Job timeout per attempt | 25 seconds                                                     |
| LLM internal timeout    | 10 seconds (before returning a controlled error to the worker) |

### What happens when retries are exhausted

When a job fails its 4th and final attempt, BullMQ emits the `failed` event. The event handler:

1. Logs the failure to `operation_logs` with `error_type: 'NETWORK_ERROR'` (or the specific error type if known).
2. Stores the full job payload and stack trace in the `failed_jobs` table (or `operation_logs` with `level: 'fatal'` if `failed_jobs` does not yet exist) for manual audit.
3. Sends a fallback message to the user: _"Hubo un problema procesando tu mensaje. Por favor, escríbelo de nuevo."_

> **Dead-letter queue:** There is no separate dead-letter queue in the MVP. Exhausted retries are persisted to PostgreSQL and reviewed manually.

---

## Broker capacity and command usage

`REDIS_URL` is provider-independent. Local development uses disposable Docker
Redis, deployed development uses an isolated Aiven for Valkey Free service under
ADR-021, and production retains its separate existing provider. Hosted connections
must use TLS through an ioredis-compatible `rediss://` URI.

| Environment | Capacity boundary                     | Operational threshold                                                         |
| ----------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| Local       | Developer machine and Docker volume   | No shared-provider quota; reset only local disposable data                    |
| Development | Runtime `maxmemory` reported by Aiven | Warn at 80% of `maxmemory`; accepted target: 250,819,379 of 313,524,224 bytes |
| Production  | Current provider limits               | Monitor independently; ADR-021 does not change production                     |

### How BullMQ consumes commands

Each job generates multiple Redis commands: `enqueue`, `lock`, `acknowledge`, `cleanup`, plus `zadd`/`zrem` for delayed jobs. A single `process-message` job can consume 6–10 Redis commands.

### Mitigations

- Keep worker concurrency conservative: **maximum 2–3 simultaneous jobs**.
- Every active Worker uses `drainDelay: 30`, so an empty queue holds its blocking poll for up to 30 seconds instead of renewing BullMQ's default five-second poll. A newly enqueued job wakes the blocking command immediately; the setting reduces empty-runtime command churn without adding a fixed 30-second processing delay.
- Keep `stalledInterval: 120_000` on all Workers. The `process-message` Worker also retains its longer lock duration and renewal interval; the drain-delay mitigation does not change concurrency, retry, stalled-job, or lock semantics.
- Cache identity resolution in Redis with a 24-hour TTL to avoid repeated PostgreSQL lookups in the handler.
- Cache `MappingConfig` in Redis with a 1-hour TTL.
- Monitor commands per minute as a capacity and anomaly signal, not as a shared
  daily development quota. The accepted Aiven no-traffic baseline is 262.28
  service-wide commands per minute; re-baseline after Worker-count, polling, or
  provider changes.
- Monitor `used_memory / maxmemory`, not advertised VM RAM. Warn at 80% and upgrade
  or reduce retained BullMQ history before the `noeviction` boundary is reached.

### Broker connection errors

BullMQ resource errors are infrastructure events and are handled separately from processor failures:

- A Worker's `failed` event means a job processor failed and follows the queue's retry and dead-letter behavior.
- A Worker or Queue `error` event reports a BullMQ or broker connection problem. Every resource registers one listener that logs `endpoint: 'bullmq'`, a stable Worker or Queue error code, the queue name, a sanitized error message, and an optional low-level `causeCode`.
- The shared root ioredis client logs the same incident independently with `endpoint: 'redis'` and `code: 'REDIS_CONNECTION_ERROR'`.

One shared-client incident can therefore produce one log for each affected BullMQ resource plus the root Redis client. This fan-out is expected and makes the affected resources visible; registering more than one `error` listener on the same resource is not. Listeners consume and report recoverable events without closing the resource or replacing ioredis and BullMQ reconnection behavior. Logs never include Redis URLs, credentials, stacks, job payloads, or user identifiers.

### Provider cutover acceptance

A broker change is complete only after TLS, latency, capacity, queue semantics,
root and blocking-connection recovery, a five-minute idle interval, scheduled work,
and a safe end-to-end messaging canary pass. Keep the previous provider unchanged
through the rollback window. See [ADR-021](../adr/ADR-021-use-aiven-valkey-for-development-bullmq.md)
and the [Deployment Operations Guide](../features/deployment.md) for the inventory,
cutover, redaction, and rollback procedure.
