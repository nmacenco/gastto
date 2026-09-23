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
- BullMQ job payloads are runtime trust boundaries: the incoming-message and process-message workers parse strict Zod schemas before any side effect. Unknown fields, invalid values, and invalid timestamps fail the job with structured logging. Incoming-message failures include the sanitized cause and retry attempt metadata, and distinguish a scheduled retry from the final failure.
- Before processing a `process-message` job, the worker verifies that its `(channel, externalId)` resolves to its declared `userId`. A mismatch is rejected before the per-user lock, state lookup, messaging, or FSM handling.
- `RouteIncomingMessage` routes `TEXT` and `UNSUPPORTED`:
  - `TEXT` → resolves user identity and applies deterministic admission unless the user belongs to the configured semantic observation cohort:
    - Outside the cohort, `IDLE` / `EXPENSE_RECEIVING` loads state and applies `ClassifyFreeTextExpenseIntent`. Expense-like or very-long messages are enqueued to `process-message`; ordinary non-financial messages receive guidance and are not enqueued.
    - Inside any non-off semantic cohort, all valid free text is enqueued without treating an ingress state read as authoritative. The thick worker reloads state under the per-user lock, computes the same deterministic decision, and resolves semantic routing there.
    - `shadow` still records a proposal and executes only the deterministic route. `enabled` can dispatch validated expense recognition in `IDLE`/`EXPENSE_RECEIVING`, missing-data completion or replacement in `EXPENSE_CLARIFYING`, correction or FIFO admission in `EXPENSE_REVIEW`, and revision-bound displayed-option selection in `ONBOARDING_FILE/default` plus `ONBOARDING_SHEET/default|idk`. Each dispatcher revalidates the captured snapshot immediately before one typed boundary.
    - Global cancellation and normalized undo commands (`deshacer`, `undo`, and `borrar el último`) bypass non-financial guidance and are enqueued to `process-message` so the FSM worker can handle them in context.
    - Spanish expense verbs are matched without requiring diacritics, so partial inputs such as `Compre cafe` reach expense interpretation and its missing-data clarification flow.
    - Any other active state (e.g. `ONBOARDING_MAPPING`, `ONBOARDING_CATEGORIES`, `EXPENSE_REVIEW`, `EXPENSE_CLARIFYING`) → the message is enqueued to `process-message` and acknowledged, bypassing the intent classifier. This ensures onboarding replies and expense corrections are handled by the FSM in context.
  - `UNSUPPORTED` → delegates to `HandleUnsupportedMessage` which replies with a friendly message.
- A thick worker (`message.worker.ts`, `concurrency: 2`) consumes `process-message` jobs and performs FSM/LLM/expense processing (ADR-005).
- Semantic resolution occurs only in the thick worker, after queue validation, messaging-identity verification, per-user lock acquisition, and current-state loading. Callback and exact confirmation, cancellation, undo, and retry paths bypass the semantic provider.
- Exact undo confirmation and exact `reconfigurar` join those sensitive bypasses. `EXPENSE_CORRECTING/default` can be projected only from a validated correction payload. Enabled Phase 2 control dispatch permits revision-bound natural cancellation in active expense drafts and confirmation-only inferred undo from `IDLE`; it still cannot save, retry, reconfigure, confirm undo, or delete without the later exact deterministic authorization.
- Enabled router/provider/schema/policy/staleness failures produce bounded application-owned guidance without unauthorized extraction, state mutation, queue admission, expense persistence, option selection, or spreadsheet writes. Numeric file/sheet replies, file search entry and queries, direct URLs, initial listing, sheet IDK/header descriptions, single-sheet auto-selection, empty-sheet confirmation, and Microsoft-unavailable handling remain deterministic. The two BullMQ payload schemas remain unchanged.
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
      ├── TEXT ──► resolve identity ──► semantic cohort?
      │                        │
      │    yes ──► process-message Queue ──► locked state + semantic turn resolution
      │    no ──► load FSM state ──► IDLE/EXPENSE_RECEIVING? ──► classify intent
      │                        │
      │        ordinary non-financial ──► guidance
      │        cancel/undo command ──► process-message Queue ──► Thick Worker
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
- [x] `RouteIncomingMessage.spec.ts` — TEXT routing (identity, enqueue, ack, ack-failure logging), global cancel/undo command bypass, UNSUPPORTED delegation.
- [x] `HandleUnsupportedMessage.spec.ts` — exact copy sent, no-throw on send failure.
- [x] `SendImmediateAcknowledgement.spec.ts` — success path, port-level failure, exception handling, optional `userId` and `whatsapp` channel acceptance.
- [x] `ProcessedMessageKey.spec.ts` — construction, channel validation, empty ID validation, equality.
- [x] `ProcessedMessageRepository.spec.ts` — contract test for `exists` and `markAsProcessed`.
- [x] `telegram.webhook.spec.ts` — origin authentication before body validation, private-chat routing, metadata-only malformed logging, non-private zero-side-effect acknowledgment, unsupported messages, `/start` short-circuit, and FIFO enqueue.
- [x] `telegram.webhook.integration.spec.ts` — end-to-end scenarios including accent-insensitive partial expenses, undo-command routing, and non-financial replies during active onboarding states that must be enqueued to `process-message` instead of receiving guidance.
- [x] `incomingMessage.worker.spec.ts` — strict payload validation, job deserialization, FIFO processing, worker construction (`concurrency: 1`), and retry/final failed-event logging with sanitized causes.
- [x] `semantic-router-shadow-pipeline.integration.spec.ts` - real PostgreSQL/Redis coverage for cohort admission, deduplication, identity mismatch, contention, stale context, provider failures, flag rollback, privacy, and webhook-to-worker output equivalence.
- [x] `semantic-router-expense-flows.integration.spec.ts` - real webhook, BullMQ DTO, Redis deduplication/locking, PostgreSQL FSM/queue/record, enabled recognition, clarification, correction, overflow, bound save, provider failure, and active-state rollback coverage.
- [x] `message.worker.spec.ts` - enabled expense dispatch plus snapshot-bound typed file/sheet handoffs, controlled failures, application-owned option guidance, legacy file/sheet-path bypass, original-message continuity, FIFO overflow, stale review binding, and no premature success confirmation.
- [x] `semantic-router-option-selection.integration.spec.ts` - Eight passing PostgreSQL/Redis scenarios cover file-to-sheet selection, IDK, duplicate/stale references, failure recovery, lease/lock safety, duplicate delivery, and flag-only rollback.
- [x] `semantic-router-control-flows.integration.spec.ts` - Seven passing PostgreSQL/Redis scenarios cover revision-bound cancellation/FIFO, confirmation-only inferred undo, exact immediate undo, request-only retry, one later exact append, and bounded reconfiguration.

## Related User Stories

- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.02-receive-parse-and-route-incoming-messages/HU-0.02 — Receive, Parse and Route Incoming Messages.md`

## Notes

- The `ProcessMessageJobData` type was moved from `src/interfaces/http/routes/telegram.webhook.ts` to `src/application/ports/ProcessMessageJob.ts` so that both the Interfaces layer (webhook route) and the Application layer (router use case) can depend on it without circular imports.
- The `IncomingMessageJobData` type lives in `src/application/ports/IncomingMessageJob.ts` for the same reason: shared between the webhook route and the thin worker.
- Clean Architecture boundary is enforced: the router use case depends on `MessagingOutputPort` (application layer) and `Queue` abstractions, never on concrete Telegram adapters. The `MessagingOutputPort` returns a discriminated `SendResult` union (`{ status: 'success' } | { status: 'failure'; errorCode: string }`) so use cases can observe delivery outcomes without leaking provider-specific errors.
- FIFO guarantee is provided by `concurrency: 1` on the `incoming-message` worker (ADR-011). When volume grows, this can be replaced with BullMQ Pro Groups or a partition strategy by `chat_id` hash.
- **Per-user serialization in the thick worker:** the `process-message` worker (`concurrency: 2`) serializes processing per user via a Redis mutex (`IUserProcessingLock`). If a second job for the same user arrives while the first is executing, it throws `UserAlreadyProcessingError`, which triggers a custom BullMQ backoff strategy that retries only lock contention with exponential backoff (500ms → 1s → 2s → 4s, capped at 5s) for up to 12 attempts. The eleven delays total 42.5 seconds, excluding processing and queue latency. This mitigates contention without re-running side-effectful handlers, but slower inference can still exhaust the budget. The renewable 180-second lock TTL is not a handler deadline. All other errors return `-1` (no retry), preserving side-effect safety. Different users' jobs proceed in parallel. Worker logs distinguish retryable contention from permanent errors, including non-lock errors with attempts remaining and jobs already marked finished. Serialization does not guarantee FIFO between delayed retries and newer arrivals. Existing jobs retain their saved attempt options.
- **Flag-only rollback:** both queue schemas are unchanged. A job admitted while a state was in `shadow` resolves the current mode only after acquiring the lock; changing that state to `off` therefore prevents a model call and executes the deterministic path without a migration or dead-letter handoff.
- **Release outcome accounting:** aggregate rollout evidence counts an eligible expense once at application admission. Duplicate delivery and repeated callbacks do not add starts; a queued expense starts once when admitted and does not restart when advanced. Direct, clarified, corrected, cancelled, timed-out, failed, retried, and unknown outcomes retain distinct codes against the same expense denominator. Option and control outcomes are separate capabilities and cannot inflate completed-expense counts.
- **Exercised expense rollback:** queued clarification and review turns continue through the deterministic handlers after `enabled → shadow → off`; persisted source text, review bindings, and pending rows require no rewrite or migration.
- **Enabled semantic actions:** `register_expense` runs interpretation in `IDLE`/`EXPENSE_RECEIVING`, replaces a draft in `EXPENSE_CLARIFYING`, and admits raw input to the pending queue in `EXPENSE_REVIEW`; `provide_missing_expense_data` completes the active clarification; `correct_expense` updates the active review through validated correction mode. `select_option` resolves only the current application-owned file or sheet snapshot and hands off one trusted position. `cancel_current_flow` delegates only to captured active-draft cancellation, while `undo_last_expense` can only present a new bound confirmation. `request_save_retry` sends the application-owned exact-command prompt without mutation or append, and `request_reconfiguration` can call only the existing Google recovery use case with the captured retry precondition. Save, retry execution, empty-sheet confirmation, and deletion authority remain unavailable to semantic proposals. Exact `reintentar`, `reconfigurar`, cancellation, undo, and bound confirmations remain deterministic sensitive-command bypasses.

## Review callback safety

- The Telegram parser accepts compact `er1` expense-review callbacks and preserves old JSON action callbacks only as unbound compatibility data. Malformed versioned callbacks remain explicitly invalid.
- The incoming and processing queue schemas preserve the complete normalized callback without dropping operation identity or review revision.
- Telegram callback sender identity must match the authenticated private chat identity before queueing. Duplicate external callback IDs remain protected by the processed-message guard.
- `receivedAt` for text comes from the validated channel timestamp. Telegram callback occurrence time uses authenticated webhook receipt time because callback queries do not expose a tap timestamp.
- Review callbacks are not global cancellation commands. Outside `EXPENSE_REVIEW` they produce no state mutation or financial effect.
