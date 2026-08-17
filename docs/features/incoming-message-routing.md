# Feature: Receive, Parse and Route Incoming Messages

## Purpose

Handle all incoming messages from external channels (Telegram, WhatsApp). Extract relevant data from the raw webhook payload, normalise it into a channel-agnostic domain representation, and route each message to the appropriate downstream handler based on its type. This is the foundational layer on top of which all conversational flows are built.

## Behavior (Implemented)

- The system receives raw JSON payloads from Telegram webhooks at `POST /webhook/telegram`.
- Telegram origin authentication runs in Fastify's `onRequest` lifecycle hook, before body parsing and validation. Requests without the configured secret return HTTP 403.
- Only authenticated private chats are processed. Authenticated `group`, `supergroup`, `channel`, and unclassified chat updates return HTTP 200 with `{ ok: true }` without payload normalization, identity resolution, queueing, acknowledgement, or conversation-state changes.
- A thin Infrastructure parser (`TelegramPayloadParser`) maps the raw payload to the domain `NormalizedPayload` contract without throwing.
- The parser distinguishes three message types:
  - `TEXT`: a message containing non-empty text.
  - `UNSUPPORTED`: a valid payload without text (photo, audio, sticker, etc.).
  - `MALFORMED`: anything that does not match the expected Telegram schema.
- Every valid payload carries a stable `externalMessageId` extracted from `message.message_id` (Telegram) and propagated as a string through all job data types to avoid precision loss.
- The Fastify route handler (`telegram.webhook.ts`) short-circuits `MALFORMED` payloads at the route layer:
  - For malformed updates identified as private, logs structured operational metadata via `req.log.error({ endpoint: '/webhook/telegram', code: 'MALFORMED_PAYLOAD' })`.
  - Returns HTTP 200 immediately to prevent Telegram retry loops.
- For all other payloads, the route enqueues an `IncomingMessageJobData` to the `incoming-message` BullMQ queue and returns HTTP 200.
- A thin FIFO worker (`incomingMessage.worker.ts`, `concurrency: 1`) consumes `incoming-message` jobs, deserializes `timestamp` back to `Date`, rebuilds `NormalizedPayload`, and delegates to `RouteIncomingMessage.execute()`.
- BullMQ job payloads are runtime trust boundaries: the incoming-message and process-message workers parse strict Zod schemas before any side effect. Unknown fields, invalid values, and invalid timestamps fail the job with metadata-only logging.
- Before processing a `process-message` job, the worker verifies that its `(channel, externalId)` resolves to its declared `userId`. A mismatch is rejected before the per-user lock, state lookup, messaging, or FSM handling.
- `RouteIncomingMessage` routes `TEXT` and `UNSUPPORTED`:
  - `TEXT` → resolves user identity, loads the current conversation state, and decides based on the FSM state:
    - `IDLE` / `EXPENSE_RECEIVING` → classifies the text with `ClassifyFreeTextExpenseIntent`. Expense-like or very-long messages are enqueued to `process-message` and acknowledged; non-financial messages receive guidance and are not enqueued.
    - Any other active state (e.g. `ONBOARDING_MAPPING`, `ONBOARDING_CATEGORIES`, `EXPENSE_REVIEW`, `EXPENSE_CLARIFYING`) → the message is enqueued to `process-message` and acknowledged, bypassing the intent classifier. This ensures onboarding replies and expense corrections are handled by the FSM in context.
  - `UNSUPPORTED` → delegates to `HandleUnsupportedMessage` which replies with a friendly message.
- A thick worker (`message.worker.ts`, `concurrency: 2`) consumes `process-message` jobs and performs FSM/LLM/expense processing (ADR-005).
- The immediate acknowledgment is sent by the dedicated `SendImmediateAcknowledgement` application use case, which depends only on `MessagingOutputPort` and returns a typed `SendResult`.
- Duplicate message protection is modeled by the `ProcessedMessageKey` value object (`channel` + `externalMessageId`) and the `IProcessedMessageRepository` driven port. Downstream consumers will use `exists()` / `markAsProcessed()` to skip or record already-handled messages.
- The system always responds HTTP 200 to Telegram to prevent infinite retry loops.
- Unsupported message copy (public contract): `"For now I only process text messages. Tell me about your expense by typing it."`
- Immediate acknowledgment copy (public contract): `"Recibido, procesando tu mensaje…"`

## Pipeline (ADR-011)

```
Telegram Webhook
      │
      ▼
onRequest origin authentication ── invalid? ──► 403
      │
      ▼
Private chat guard ── non-private/unknown? ──► 200 OK, no side effects
      │
      ▼
Fastify Handler ── private MALFORMED? ──► req.log.error + 200 OK
      │
      ▼
/start? ──► HandleStartCommand (sync)
      │
      ▼
incoming-message Queue (BullMQ) ──► Thin Worker (concurrency: 1, FIFO)
      │
      ▼
RouteIncomingMessage.execute()
      │
      ├── TEXT ──► resolve identity ──► load FSM state
      │                        │
      │    IDLE/EXPENSE_RECEIVING? ──► classify intent
      │                        │
      │        non-financial ──► guidance
      │        financial/too-long ──► process-message Queue ──► Thick Worker
      │
      │    active state ──► process-message Queue ──► Thick Worker
      │
      └── UNSUPPORTED ──► HandleUnsupportedMessage
```

## Behavior (TODO)

- WhatsApp webhook adapter (HU-0.02 does not cover WhatsApp yet).
- ~~Malformed payload handler that actively notifies admins or persists to an operations log~~ — Done at route layer via `req.log.error` (ADR-011).
- Rate-limiting or flood protection for rapid successive messages (partially addressed by FIFO ordering; explicit rate limits still TODO).

## API / Interface

- `POST /webhook/telegram` — Receives Telegram Update JSON. Origin validation happens before request-body parsing; unauthenticated requests return HTTP 403. Authenticated updates return `{ ok: true }` with HTTP 200, but only private chats are processed.

## Data Model

No database schema changes yet. The feature operates on transient domain value objects and driven ports:

- `NormalizedPayload` — defined in `src/domain/ports/messaging.ts`. Includes `externalMessageId?: string | undefined` for valid payloads.
- `IncomingMessageJobData` — serializable BullMQ job data, defined in `src/application/ports/IncomingMessageJob.ts`. Carries `externalMessageId: string`.
- `ProcessMessageJobData` — serializable BullMQ job data, defined in `src/application/ports/ProcessMessageJob.ts`. Carries `externalMessageId: string`.
- `IncomingMessage` — defined in `src/domain/value-objects/IncomingMessage.ts` (used for validated TEXT messages).
- `ProcessedMessageKey` — immutable domain value object in `src/domain/value-objects/ProcessedMessageKey.ts` combining `channel` and `externalMessageId` for idempotency.
- `IProcessedMessageRepository` — driven port in `src/domain/ports/ProcessedMessageRepository.ts` with `exists(key)` and `markAsProcessed(key)`.
- `MessageType` — union type `'TEXT' | 'UNSUPPORTED' | 'MALFORMED'`.
- `MessagingOutputPort` — application-layer output port, defined in `src/application/ports/output/messaging.port.ts`.
- `SendResult` — discriminated union (`SendResultSuccess | SendResultFailure`) returned by `MessagingOutputPort.sendMessage`.
- `SendImmediateAcknowledgement` — application use case in `src/application/use-cases/conversation/SendImmediateAcknowledgement.ts` that sends the processing acknowledgment copy.

## Tests

- [x] `TelegramPayloadParser.spec.ts` — private and non-private chat-scope classification, happy path, unsupported types (photo, audio, sticker), empty text, malformed payloads, null payloads, `externalMessageId` extraction.
- [x] `messaging.spec.ts` — `NormalizedPayload` contract, including optional `externalMessageId`.
- [x] `RouteIncomingMessage.spec.ts` — TEXT routing (identity, enqueue, ack, ack-failure logging), UNSUPPORTED delegation.
- [x] `HandleUnsupportedMessage.spec.ts` — exact copy sent, no-throw on send failure.
- [x] `SendImmediateAcknowledgement.spec.ts` — success path, port-level failure, exception handling, optional `userId` and `whatsapp` channel acceptance.
- [x] `ProcessedMessageKey.spec.ts` — construction, channel validation, empty ID validation, equality.
- [x] `ProcessedMessageRepository.spec.ts` — contract test for `exists` and `markAsProcessed`.
- [x] `telegram.webhook.spec.ts` — origin authentication before body validation, private-chat routing, metadata-only malformed logging, non-private zero-side-effect acknowledgment, unsupported messages, `/start` short-circuit, and FIFO enqueue.
- [x] `telegram.webhook.integration.spec.ts` — end-to-end scenarios including non-financial replies during active onboarding states that must be enqueued to `process-message` instead of receiving guidance.
- [x] `incomingMessage.worker.spec.ts` — strict payload validation, job deserialization, FIFO processing, worker construction (`concurrency: 1`), and metadata-only failed-event logging.

## Related User Stories

- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.02-receive-parse-and-route-incoming-messages/HU-0.02 — Receive, Parse and Route Incoming Messages.md`

## Notes

- The `ProcessMessageJobData` type was moved from `src/interfaces/http/routes/telegram.webhook.ts` to `src/application/ports/ProcessMessageJob.ts` so that both the Interfaces layer (webhook route) and the Application layer (router use case) can depend on it without circular imports.
- The `IncomingMessageJobData` type lives in `src/application/ports/IncomingMessageJob.ts` for the same reason: shared between the webhook route and the thin worker.
- Clean Architecture boundary is enforced: the router use case depends on `MessagingOutputPort` (application layer) and `Queue` abstractions, never on concrete Telegram adapters. The `MessagingOutputPort` returns a discriminated `SendResult` union (`{ status: 'success' } | { status: 'failure'; errorCode: string }`) so use cases can observe delivery outcomes without leaking provider-specific errors.
- FIFO guarantee is provided by `concurrency: 1` on the `incoming-message` worker (ADR-011). When volume grows, this can be replaced with BullMQ Pro Groups or a partition strategy by `chat_id` hash.
- **Per-user serialization in the thick worker:** the `process-message` worker (`concurrency: 2`) serializes processing per user via a Redis mutex (`IUserProcessingLock`). If a second job for the same user arrives while the first is executing, it throws `UserAlreadyProcessingError`, which triggers a custom BullMQ backoff strategy that retries only lock contention with exponential backoff (500ms → 1s → 2s → 4s, capped at 5s). All other errors return `-1` (no retry), preserving side-effect safety. Different users' jobs proceed in parallel.
