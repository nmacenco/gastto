# Plan: Immediate acknowledgment and idempotency foundation

**Plan file:** `ai/plans/2026_07_21-immediate_acknowledgment_idempotency/2026_07_21-immediate_acknowledgment_idempotency-plan.md`  
**Date:** 2026-07-21  
**Scope:** Fulfill user-story tasks T-E1-US-02-01, T-E1-US-02-02 and T-E1-US-02-03.

## Goal

Extend the incoming-message pipeline so every external message carries a stable ID, introduce a domain-level idempotency contract, and create a dedicated application use case that sends the immediate "received" acknowledgment.

## Context

- User story: `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-02-immediate-acknowledgment-of-receipt/E1-US-02 — Immediate acknowledgment of receipt.md`
- Tasks to close:
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-02-immediate-acknowledgment-of-receipt/tasks/T-E1-US-02-01.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-02-immediate-acknowledgment-of-receipt/tasks/T-E1-US-02-02.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-02-immediate-acknowledgment-of-receipt/tasks/T-E1-US-02-03.md`
- Feature documentation: `docs/features/incoming-message-routing.md`
- Architecture decisions:
  - `docs/adr/ADR-005-bullmq-redis.md` — async BullMQ pipeline.
  - `docs/adr/ADR-011-two-stage-pipeline.md` — thin FIFO worker plus thick worker.
  - `docs/adr/ADR-012-user-facing-text-copies.md` — copy modules live in the Application layer.
- Key source files:
  - `src/domain/ports/messaging.ts` — `NormalizedPayload` contract.
  - `src/application/ports/IncomingMessageJob.ts` — `IncomingMessageJobData`.
  - `src/application/ports/ProcessMessageJob.ts` — `ProcessMessageJobData`.
  - `src/infrastructure/adapters/telegram/TelegramPayloadParser.ts` — Telegram payload parser.
  - `src/application/ports/output/messaging.port.ts` — `MessagingOutputPort` contract.
  - `src/application/copies/shared.copies.ts` — acknowledgment copy.
  - `src/application/use-cases/conversation/RouteIncomingMessage.ts` — downstream consumer that will later use the idempotency contract.
- Existing tests to extend:
  - `src/domain/ports/messaging.spec.ts`
  - `src/infrastructure/adapters/telegram/TelegramPayloadParser.spec.ts`

## Public contracts

- **Domain payload**: `NormalizedPayload` gains an optional `externalMessageId: string | undefined` field. Keeping it optional preserves the current `MALFORMED` handling path (which sets `chatId: 'unknown'` and has no reliable external ID).
- **Job data**: `IncomingMessageJobData` and `ProcessMessageJobData` gain `externalMessageId: string`. The field is required in job data because only valid, parsed messages are enqueued.
- **Value object**: new `ProcessedMessageKey` in `src/domain/value-objects/` combining `channel: 'telegram' | 'whatsapp'` and `externalMessageId: string`, with a factory that validates non-empty values and an `equals` method.
- **Repository port**: new `IProcessedMessageRepository` in `src/domain/ports/ProcessedMessageRepository.ts` with `exists(key): Promise<boolean>` and `markAsProcessed(key): Promise<void>`.
- **Application service**: new `SendImmediateAcknowledgement` class in `src/application/use-cases/conversation/` with `execute(input): Promise<SendResult>`, depending only on `MessagingOutputPort`.
- **Copies**: `sharedCopies.processingAcknowledgment()` may be refined so the acknowledgment is brief and visually/textually distinct from the final interpreted summary.
- **Test suites**:
  - Updated `src/domain/ports/messaging.spec.ts`.
  - Updated `src/infrastructure/adapters/telegram/TelegramPayloadParser.spec.ts`.
  - New `src/domain/value-objects/ProcessedMessageKey.spec.ts`.
  - New `src/application/ports/ProcessedMessageRepository.spec.ts` (contract test).
  - New `src/application/use-cases/conversation/SendImmediateAcknowledgement.spec.ts`.

## Phases

### Phase 1: Add external message ID to NormalizedPayload and job data

- [x] Add `externalMessageId?: string | undefined` to `NormalizedPayload` in `src/domain/ports/messaging.ts`.
- [x] Add `externalMessageId: string` to `IncomingMessageJobData` in `src/application/ports/IncomingMessageJob.ts`.
- [x] Add `externalMessageId: string` to `ProcessMessageJobData` in `src/application/ports/ProcessMessageJob.ts`.
- [x] Update `looksLikeTelegramUpdate` in `src/infrastructure/adapters/telegram/TelegramPayloadParser.ts` to require `message_id` as `number | string`.
- [x] Extract `message.message_id` in `parseTelegramPayload`, convert it to `String()`, and surface it as `externalMessageId` for `TEXT` and `UNSUPPORTED` payloads.
- [x] Ensure `MALFORMED` payloads continue to omit `externalMessageId` (optional field).
- [x] Update `src/domain/ports/messaging.spec.ts` to assert that `externalMessageId` can be provided and omitted.
- [x] Update `src/infrastructure/adapters/telegram/TelegramPayloadParser.spec.ts` to assert `externalMessageId` is extracted correctly for text and unsupported messages and is absent for malformed payloads.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Define idempotency key value object and repository port

- [x] Create `src/domain/value-objects/ProcessedMessageKey.ts`:
  - `ProcessedMessageKeyProps` interface with `channel: 'telegram' | 'whatsapp'` and `externalMessageId: string`.
  - `ProcessedMessageKey` class with constructor validation (both fields non-empty, channel restricted).
  - `equals(other: ProcessedMessageKey): boolean` method.
- [x] Create `src/domain/ports/ProcessedMessageRepository.ts`:
  - `IProcessedMessageRepository` interface with `exists(key: ProcessedMessageKey): Promise<boolean>` and `markAsProcessed(key: ProcessedMessageKey): Promise<void>`.
- [x] Create `src/domain/value-objects/ProcessedMessageKey.spec.ts`:
  - Test successful creation for telegram and whatsapp keys.
  - Test factory throws when `channel` is invalid.
  - Test factory throws when `externalMessageId` is empty.
  - Test equality for matching and non-matching keys.
- [x] Create `src/application/ports/ProcessedMessageRepository.spec.ts` as a contract test that verifies a mock implementation satisfies the port interface.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Implement immediate acknowledgment use case

- [x] Refine `sharedCopies.processingAcknowledgment()` in `src/application/copies/shared.copies.ts` if needed so the copy is clearly different from the final expense summary (e.g., "Recibido, procesando tu mensaje…" with an ellipsis and no expense details).
- [x] Create `src/application/use-cases/conversation/SendImmediateAcknowledgement.ts`:
  - Constructor depends only on `MessagingOutputPort`.
  - `execute(input: { chatId: string; channel: 'telegram' | 'whatsapp'; userId?: string }): Promise<SendResult>`.
  - Sends `sharedCopies.processingAcknowledgment()` via `messagingPort.sendMessage(chatId, ...)`.
  - Returns the `SendResult` from the port.
- [x] Create `src/application/use-cases/conversation/SendImmediateAcknowledgement.spec.ts`:
  - Test success path: `sendMessage` called once with the chat ID and acknowledgment copy, and the use case returns the success result.
  - Test failure path: `sendMessage` returns `{ status: 'failure', errorCode: 'SEND_FAILED' }` and the use case returns that result without throwing.
  - Test exception path: `sendMessage` rejects and the use case surfaces the failure as a `SendResultFailure` or rethrows in a controlled way (decide based on existing patterns; prefer returning a failure result to keep the signature honest).
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. The remaining follow-up work is to wire the new `SendImmediateAcknowledgement` use case and `IProcessedMessageRepository` into `RouteIncomingMessage` so the pipeline actually sends the acknowledgment and skips duplicate messages.
