# Feature: Receive, Parse and Route Incoming Messages

## Purpose

Handle all incoming messages from external channels (Telegram, WhatsApp). Extract relevant data from the raw webhook payload, normalise it into a channel-agnostic domain representation, and route each message to the appropriate downstream handler based on its type. This is the foundational layer on top of which all conversational flows are built.

## Behavior (Implemented)

- The system receives raw JSON payloads from Telegram webhooks at `POST /webhook/telegram`.
- A thin Infrastructure parser (`TelegramPayloadParser`) maps the raw payload to the domain `NormalizedPayload` contract without throwing.
- The parser distinguishes three message types:
  - `TEXT`: a message containing non-empty text.
  - `UNSUPPORTED`: a valid payload without text (photo, audio, sticker, etc.).
  - `MALFORMED`: anything that does not match the expected Telegram schema.
- The Fastify route handler (`telegram.webhook.ts`) short-circuits `MALFORMED` payloads at the route layer:
  - Logs a structured error via `req.log.error({ endpoint: '/webhook/telegram', code: 'MALFORMED_PAYLOAD', rawPayload: req.body })`.
  - Returns HTTP 200 immediately to prevent Telegram retry loops.
- For all other payloads, the route enqueues an `IncomingMessageJobData` to the `incoming-message` BullMQ queue and returns HTTP 200.
- A thin FIFO worker (`incomingMessage.worker.ts`, `concurrency: 1`) consumes `incoming-message` jobs, deserializes `timestamp` back to `Date`, rebuilds `NormalizedPayload`, and delegates to `RouteIncomingMessage.execute()`.
- `RouteIncomingMessage` routes `TEXT` and `UNSUPPORTED`:
  - `TEXT` → resolves user identity, enqueues a `process-message` job, and sends an acknowledgment.
  - `UNSUPPORTED` → delegates to `HandleUnsupportedMessage` which replies with a friendly message.
- A thick worker (`message.worker.ts`, `concurrency: 2`) consumes `process-message` jobs and performs FSM/LLM/expense processing (ADR-005).
- The system always responds HTTP 200 to Telegram to prevent infinite retry loops.
- Unsupported message copy (public contract): `"For now I only process text messages. Tell me about your expense by typing it."`

## Pipeline (ADR-011)

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
incoming-message Queue (BullMQ) ──► Thin Worker (concurrency: 1, FIFO)
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

## Behavior (TODO)

- WhatsApp webhook adapter (HU-0.02 does not cover WhatsApp yet).
- ~~Malformed payload handler that actively notifies admins or persists to an operations log~~ — Done at route layer via `req.log.error` (ADR-011).
- Rate-limiting or flood protection for rapid successive messages (partially addressed by FIFO ordering; explicit rate limits still TODO).

## API / Interface

- `POST /webhook/telegram` — Receives Telegram Update JSON. Origin-validated by `telegramAuth` middleware. Always returns `{ ok: true }` with HTTP 200.

## Data Model

No database schema changes. The feature operates on transient domain value objects:

- `NormalizedPayload` — defined in `src/domain/ports/messaging.ts`.
- `IncomingMessageJobData` — serializable BullMQ job data, defined in `src/application/ports/IncomingMessageJob.ts`.
- `IncomingMessage` — defined in `src/domain/value-objects/IncomingMessage.ts` (used for validated TEXT messages).
- `MessageType` — union type `'TEXT' | 'UNSUPPORTED' | 'MALFORMED'`.
- `MessagingOutputPort` — application-layer output port, defined in `src/application/ports/output/messaging.port.ts`.
- `SendResult` — discriminated union (`SendResultSuccess | SendResultFailure`) returned by `MessagingOutputPort.sendMessage`.

## Tests

- [x] `TelegramPayloadParser.spec.ts` — happy path, unsupported types (photo, audio, sticker), empty text, malformed payloads, null payloads.
- [x] `RouteIncomingMessage.spec.ts` — TEXT routing (identity, enqueue, ack, ack-failure logging), UNSUPPORTED delegation.
- [x] `HandleUnsupportedMessage.spec.ts` — exact copy sent, no-throw on send failure.
- [x] `telegram.webhook.spec.ts` — 200 for valid text + enqueue, 200 for unparseable + MALFORMED log, 200 for unsupported + enqueue, `/start` short-circuit, 3 rapid messages FIFO enqueue.
- [x] `incomingMessage.worker.spec.ts` — job deserialization, FIFO processing, worker construction (`concurrency: 1`), failed-event structured logging.

## Related User Stories

- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.02-receive-parse-and-route-incoming-messages/HU-0.02 — Receive, Parse and Route Incoming Messages.md`

## Notes

- The `ProcessMessageJobData` type was moved from `src/interfaces/http/routes/telegram.webhook.ts` to `src/application/ports/ProcessMessageJob.ts` so that both the Interfaces layer (webhook route) and the Application layer (router use case) can depend on it without circular imports.
- The `IncomingMessageJobData` type lives in `src/application/ports/IncomingMessageJob.ts` for the same reason: shared between the webhook route and the thin worker.
- Clean Architecture boundary is enforced: the router use case depends on `MessagingOutputPort` (application layer) and `Queue` abstractions, never on concrete Telegram adapters. The `MessagingOutputPort` returns a discriminated `SendResult` union (`{ status: 'success' } | { status: 'failure'; errorCode: string }`) so use cases can observe delivery outcomes without leaking provider-specific errors.
- FIFO guarantee is provided by `concurrency: 1` on the `incoming-message` worker (ADR-011). When volume grows, this can be replaced with BullMQ Pro Groups or a partition strategy by `chat_id` hash.
