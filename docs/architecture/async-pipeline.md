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
8. If the new state has a timeout, enqueues a delayed `fsm-timeout` job.

---

## Job types defined

| Job type          | Payload                                                  | Purpose                                                                                             |
| ----------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `process-message` | `{ userId, channel, externalId, rawMessage, externalMessageId, receivedAt, callbackData? }` | Main pipeline job. Triggered on every incoming message. |
| `incoming-message` | `{ messageType, chatId, timestamp, channel, externalMessageId, ... }` | FIFO ingress job. Strictly validated before normalization. |
| `oauth-reminder` | `{ userId, externalId, channel }` | Delayed OAuth reminder. Requires identity binding validation. |
| `fsm-timeout`     | `{ userId, expectedState, firedAt }`                     | Delayed job that transitions the user to `IDLE` if they are still in `expectedState` after the TTL. |
| `scheduled-alert` | _(future)_                                               | Reserved for Release 2 periodic alerts and automated summaries. Not implemented in MVP.             |

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

## Upstash free-tier limits relevant to BullMQ

| Limit                  | Value                                | Alert threshold             |
| ---------------------- | ------------------------------------ | --------------------------- |
| Redis commands per day | 10,000                               | > 6,000 / day               |
| Memory                 | 256 MB                               | Monitor heap of the process |
| Connections            | No hard limit, but keep conservative | —                           |

### How BullMQ consumes commands

Each job generates multiple Redis commands: `enqueue`, `lock`, `acknowledge`, `cleanup`, plus `zadd`/`zrem` for delayed jobs. A single `process-message` job can consume 6–10 Redis commands.

### Mitigations

- Keep worker concurrency conservative: **maximum 2–3 simultaneous jobs**.
- Cache identity resolution in Redis with a 24-hour TTL to avoid repeated PostgreSQL lookups in the handler.
- Cache `MappingConfig` in Redis with a 1-hour TTL.
- Monitor command count daily; if approaching 6,000, consider upgrading the Upstash tier.
