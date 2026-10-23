# Plan: Wire immediate acknowledgment and idempotency into the pipeline

**Plan file:** `ai/plans/2026_07_21-wire_immediate_ack_and_idempotency/2026_07_21-wire_immediate_ack_and_idempotency-plan.md`  
**Date:** 2026-07-21  
**Scope:** Fulfill user-story tasks T-E1-US-02-04, T-E1-US-02-05 and T-E1-US-02-06.

## Goal

Move the immediate acknowledgment emission from the asynchronous `RouteIncomingMessage` use case into the `POST /webhook/telegram` handler so the ack is returned within <= 1 second, add a Redis-backed idempotency repository, and integrate it into `RouteIncomingMessage` so duplicate Telegram retries do not create duplicate expense records.

## Context

- User story: `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-02-immediate-acknowledgment-of-receipt/E1-US-02 — Immediate acknowledgment of receipt.md`
- Tasks to close:
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-02-immediate-acknowledgment-of-receipt/tasks/T-E1-US-02-04.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-02-immediate-acknowledgment-of-receipt/tasks/T-E1-US-02-05.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-02-immediate-acknowledgment-of-receipt/tasks/T-E1-US-02-06.md`
- Feature documentation: `docs/features/incoming-message-routing.md`
- Architecture decisions:
  - `docs/adr/ADR-005-bullmq-redis.md` — async BullMQ pipeline.
  - `docs/adr/ADR-011-two-stage-pipeline.md` — thin FIFO worker plus thick worker.
- Key source files:
  - `src/interfaces/http/routes/telegram.webhook.ts` — Fastify webhook handler.
  - `src/application/use-cases/conversation/RouteIncomingMessage.ts` — downstream router.
  - `src/application/use-cases/conversation/SendImmediateAcknowledgement.ts` — ack use case.
  - `src/domain/ports/ProcessedMessageRepository.ts` — idempotency port.
  - `src/domain/value-objects/ProcessedMessageKey.ts` — idempotency key.
  - `src/infrastructure/redis/` — existing Redis adapter patterns.
  - `src/main.ts` — composition root.
- Existing tests to extend:
  - `src/interfaces/http/routes/telegram.webhook.spec.ts`
  - `src/interfaces/http/routes/telegram.webhook.integration.spec.ts`
  - `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts`

## Public contracts

- **Application service signatures**:
  - `TelegramWebhookHandlerDeps` gains `sendImmediateAcknowledgement: SendImmediateAcknowledgement`.
  - `RouteIncomingMessageDeps` loses `messagingPort` and `logger` (ack removed) and gains `processedMessageRepository: IProcessedMessageRepository`.
- **Domain events**: None.
- **Test suites**:
  - Updated `telegram.webhook.spec.ts` and `telegram.webhook.integration.spec.ts`.
  - Updated `RouteIncomingMessage.spec.ts`.
  - New `RedisProcessedMessageRepository.spec.ts`.
- **Database schemas**: None.
- **Text copies**: Reuse `sharedCopies.processingAcknowledgment()` — no copy change.

## Phases

### Phase 1: Move immediate acknowledgment to the Telegram webhook (T-E1-US-02-04)

**Description**: Make the Fastify webhook handler responsible for sending the immediate acknowledgment fire-and-forget, then enqueueing to `incoming-message`. Remove the now-redundant ack logic from `RouteIncomingMessage`.

- [x] Add `sendImmediateAcknowledgement: SendImmediateAcknowledgement` to `TelegramWebhookHandlerDeps` in `src/interfaces/http/routes/telegram.webhook.ts`.
- [x] In `handleTelegramWebhook`, for valid `TEXT` payloads (non-command), invoke `deps.sendImmediateAcknowledgement.execute({ chatId, channel, userId })` without awaiting (fire-and-forget).
- [x] Catch ack failures with a structured `ACK_SEND_FAILED` log and do not crash the request.
- [x] Keep `/start` and `MALFORMED` short-circuits unchanged.
- [x] Remove the ack send logic and `messagingPort`/`logger` dependencies from `RouteIncomingMessage`.
- [x] Update `RouteIncomingMessage.spec.ts` to stop asserting on ack sends.
- [x] Update `telegram.webhook.spec.ts` to assert the use case is called for valid text messages and that failures are logged.
- [x] Update `telegram.webhook.integration.spec.ts` to build `SendImmediateAcknowledgement` and assert the ack originates from the webhook.
- [x] Instantiate `SendImmediateAcknowledgement` in `src/main.ts` and pass it to `registerTelegramWebhook`.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Implement Redis idempotency repository (T-E1-US-02-05)

**Description**: Add a Redis-backed implementation of `IProcessedMessageRepository` with namespaced keys and a 24-hour TTL. Cover it with unit tests using a mocked Redis client.

- [x] Create `src/infrastructure/redis/RedisProcessedMessageRepository.ts`.
- [x] Implement `IProcessedMessageRepository`:
  - `exists(key)` checks Redis for `processed_message:<channel>:<externalMessageId>`.
  - `markAsProcessed(key)` writes the key atomically with TTL (use `setex` or `SET ... EX`).
- [x] Use a 24-hour TTL (86,400 seconds) to cover Telegram retry windows without unbounded growth.
- [x] Create `src/infrastructure/redis/RedisProcessedMessageRepository.spec.ts` with mocked `ioredis`, asserting namespace, TTL, `exists` true/false, and `markAsProcessed`.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Integrate idempotency into RouteIncomingMessage (T-E1-US-02-06)

**Description**: Add the repository as a dependency of `RouteIncomingMessage`, skip duplicate messages before enqueueing to `messageQueue`, and mark first-time messages as processed. Wire the repository in `main.ts`.

- [x] Add `processedMessageRepository: IProcessedMessageRepository` to `RouteIncomingMessageDeps`.
- [x] In `RouteIncomingMessage.execute`, for `TEXT` payloads, build a `ProcessedMessageKey` and call `exists()` before enqueueing.
- [x] If the message was already processed, return early (the webhook already sent the ack).
- [x] For first-time messages, enqueue the `process-message` job and then call `markAsProcessed()`.
- [x] Keep existing classification/routing behavior unchanged.
- [x] Update `RouteIncomingMessage.spec.ts` with duplicate-detection and normal-flow tests.
- [x] Update `telegram.webhook.integration.spec.ts` to cover duplicate payloads still returning HTTP 200 and not re-enqueueing.
- [x] Instantiate `RedisProcessedMessageRepository` in `src/main.ts` and inject it into `RouteIncomingMessage`.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. Update the user-story task files (T-E1-US-02-04, T-E1-US-02-05, T-E1-US-02-06) acceptance criteria and ask the user whether to commit the changes.
