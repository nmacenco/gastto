# ADR-005: Decouple Latency with BullMQ over Redis

**Date**: 2025-04
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

The system imposes two mutually exclusive constraints in a synchronous pipeline:

- **Acknowledgment ≤ 1 second** (E1-US-02, P95 under normal load).
- **NLP processing via LLM**, which typically takes 2 to 5 seconds.

A synchronous design cannot satisfy both constraints simultaneously. A decoupling mechanism is required between message reception and processing.

The Fastify server deployed on Fly.io (ADR-009) operates as a persistent Node.js process, making the BullMQ worker model viable with an active and continuous Redis connection. No ephemeral environment restriction limits this choice.

## Considered Options

1. **Synchronous pipeline**
   - Pros: Simplest to reason about, no queue infrastructure.
   - Cons: Incompatible with the ≤ 1s acknowledgment SLA if the LLM takes 2-5 seconds.

2. **Upstash QStash (managed HTTP queue)**
   - Pros: Managed service, no Redis connection maintenance.
   - Cons: Requires ephemeral (serverless) functions as workers. Incompatible with BullMQ and conversational timeouts that need persistent processes. Discarded alongside Vercel in ADR-009.

3. **RabbitMQ / Kafka**
   - Pros: Industry-standard message brokers, high throughput.
   - Cons: Operational overhead not justified. No free operational tier for production.

4. **Database polling with Cron**
   - Pros: No additional infrastructure.
   - Cons: Introduces minimum latency of seconds between enqueue and processing. Incompatible with the < 5 second response SLA.

5. **BullMQ over Redis with persistent Fastify workers**
   - Pros: Native retry, backoff, dead letter queues, operates in persistent process.
   - Cons: Shared memory with HTTP server, Redis command limits on free tier.

## Decision

Adopt a **two-stage asynchronous pipeline with BullMQ over Redis (Upstash)** as the decoupling mechanism between webhook reception and NLP processing.

**BullMQ** is a Redis-based queue library for Node.js. Producers enqueue jobs; workers, running in the same persistent Fastify process, consume them asynchronously with native retry support, exponential backoff, and dead letter queues.

### Stage 1 — Immediate acknowledgment (target: < 300ms)

The Fastify handler at `/webhook/:channel` exclusively:

1. Receives the webhook from Telegram or WhatsApp Business API.
2. Validates origin: checks secret token in header (Telegram) or HMAC-SHA256 payload signature (WhatsApp Business API).
3. Enqueues the normalized payload in BullMQ as a `process-message` job.
4. Sends acknowledgment to the user ("Recibido, procesando tu gasto…") via Telegram/WhatsApp API.
5. Returns HTTP 200 to the messaging channel.

This stage does not call the LLM, access the spreadsheet, or query PostgreSQL beyond cached identity resolution.

### Stage 2 — Asynchronous processing (target: < 5 seconds from original message)

The BullMQ worker consumes the `process-message` job in the same Fastify process:

1. The FSM Orchestrator recovers user state from PostgreSQL.
2. The NLP Engine calls the LLM API (Claude) with the message and structured system prompt.
3. The Category Service applies semantic mapping against the user's vocabulary.
4. The Spreadsheet Service executes the write if applicable (save flow).
5. The Gateway sends the final response to the user and updates the FSM state in PostgreSQL.

If processing fails, BullMQ retries automatically with exponential backoff per configured policy.

### Retry Policy

| Parameter           | Configured Value                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Max retries         | 3                                                                                                                                 |
| Backoff             | Exponential: 1s → 2s → 4s                                                                                                         |
| Timeout per attempt | 25 seconds (NLP Engine has its own 10s timeout before returning controlled error)                                                 |
| Dead letter         | Jobs exhausting retries are captured by BullMQ's `failed` event and logged to the `failed_jobs` PostgreSQL table for manual audit |

### Webhook Origin Validation

Validation occurs in the Fastify handler before enqueuing the job, without depending on any external intermediary:

```typescript
// Telegram: verify secret token in X-Telegram-Bot-Api-Secret-Token header
function validateTelegramOrigin(req: FastifyRequest): boolean {
  return req.headers['x-telegram-bot-api-secret-token'] === process.env.TELEGRAM_WEBHOOK_SECRET;
}

// WhatsApp Business API: verify HMAC-SHA256 payload signature
function validateWhatsAppOrigin(req: FastifyRequest): boolean {
  const signature = req.headers['x-hub-signature-256'] as string;
  const expected =
    'sha256=' +
    createHmac('sha256', process.env.WHATSAPP_APP_SECRET!)
      .update(JSON.stringify(req.body))
      .digest('hex');
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

Requests failing validation are rejected with HTTP 403 without enqueuing any job or executing business logic.

## Rationale

- BullMQ operates in its native model: persistent process with active Redis connection, without workarounds or HTTP broker intermediaries.
- Automatic retries with exponential backoff and dead letter queue managed directly by BullMQ, without additional handler logic.
- Conversational FSM timeouts (10 minutes in `EXPENSE_REVIEW`, 30 minutes in onboarding) are implemented with delayed BullMQ jobs in the same runtime.
- Redis (Upstash free tier) serves as both queue broker and cache: identity resolution `(channel, externalId) → userId` and per-user column mapping.
- Origin validation uses each channel's native APIs (Telegram secret token, WhatsApp HMAC-SHA256) without third-party SDK dependencies for this purpose.

## Consequences

### Positive

- BullMQ operates natively in persistent process with active Redis connection.
- Automatic retries with exponential backoff and dead letter queue.
- FSM conversational timeouts implemented with delayed BullMQ jobs.
- Redis serves as both queue broker and cache.
- Origin validation uses native channel APIs.

### Negative

- Worker and HTTP server share process: an NLP memory leak can affect webhook availability. Mitigation: monitor heap metrics in Fly.io and configure automatic restart at critical thresholds.
- Upstash Redis free tier has a 10,000 commands/day and 256 MB limit. BullMQ generates multiple Redis commands per job (enqueue, lock, acknowledge, cleanup). Monitor from 6,000 commands/day.
- Worker concurrency must be configured conservatively (maximum 2-3 simultaneous jobs) to avoid saturating the LLM API quota or Supabase PostgreSQL free tier connection limits.

### Relevant MVP Infrastructure Limits

| Service             | Free Tier Limit                 | Alert Threshold                |
| ------------------- | ------------------------------- | ------------------------------ |
| Upstash Redis       | 10,000 commands/day, 256 MB     | > 6,000 commands/day           |
| Supabase PostgreSQL | 500 MB storage, 2 projects      | > 400 MB                       |
| Fly.io free tier    | 3 shared VMs, 256 MB RAM per VM | Monitor process heap           |
| Claude API          | No free tier; cost per token    | Configure monthly budget alert |

## References

- [`docs/adr/ADR-009-fastify-persistent.md`](./ADR-009-fastify-persistent.md)
- [`docs/adr/ADR-003-fsm-postgresql.md`](./ADR-003-fsm-postgresql.md)
- [`docs/architecture/async-pipeline.md`](../architecture/async-pipeline.md)
