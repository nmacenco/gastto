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
- An Application-layer router (`RouteIncomingMessage`) receives the `NormalizedPayload` and dispatches to the correct handler:
  - `TEXT` → resolves user identity, enqueues a BullMQ job, and sends an acknowledgment.
  - `UNSUPPORTED` → delegates to `HandleUnsupportedMessage` which replies with a friendly message.
  - `MALFORMED` → logs a structured error and returns silently (the HTTP layer already responded 200).
- The Fastify route handler (`telegram.webhook.ts`) no longer contains business logic; it only validates origin, parses the body, short-circuits `/start`, and delegates to the router.
- The system always responds HTTP 200 to Telegram to prevent infinite retry loops.
- Unsupported message copy (public contract): `"For now I only process text messages. Tell me about your expense by typing it."`

## Behavior (TODO)

- WhatsApp webhook adapter (HU-0.02 does not cover WhatsApp yet).
- Malformed payload handler that actively notifies admins or persists to an operations log (currently only logs to stderr).
- Rate-limiting or flood protection for rapid successive messages.

## API / Interface

- `POST /webhook/telegram` — Receives Telegram Update JSON. Origin-validated by `telegramAuth` middleware. Always returns `{ ok: true }` with HTTP 200.

## Data Model

No database schema changes. The feature operates on transient domain value objects:

- `NormalizedPayload` — defined in `src/domain/ports/messaging.ts`.
- `IncomingMessage` — defined in `src/domain/value-objects/IncomingMessage.ts` (used for validated TEXT messages).
- `MessageType` — union type `'TEXT' | 'UNSUPPORTED' | 'MALFORMED'`.

## Tests

- [x] `TelegramPayloadParser.spec.ts` — happy path, unsupported types (photo, audio, sticker), empty text, malformed payloads, null payloads.
- [x] `RouteIncomingMessage.spec.ts` — TEXT routing (identity, enqueue, ack), UNSUPPORTED delegation, MALFORMED logging.
- [x] `HandleUnsupportedMessage.spec.ts` — exact copy sent, no-throw on send failure.
- [x] `telegram.webhook.spec.ts` — 200 for valid text, 200 for unparseable, 200 for unsupported, `/start` short-circuit.

## Related User Stories

- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.02-receive-parse-and-route-incoming-messages/HU-0.02 — Receive, Parse and Route Incoming Messages.md`

## Notes

- The `ProcessMessageJobData` type was moved from `src/interfaces/http/routes/telegram.webhook.ts` to `src/application/ports/ProcessMessageJob.ts` so that both the Interfaces layer (webhook route) and the Application layer (router use case) can depend on it without circular imports.
- Clean Architecture boundary is enforced: the router use case depends on `MessagingPort` and `Queue` abstractions, never on concrete Telegram adapters.
