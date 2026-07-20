# Plan: Free-text expense routing and guidance

**Plan file:** `ai/plans/2026_07_20-free_text_expense_routing_guidance/2026_07_20-free_text_expense_routing_guidance-plan.md`  
**Date:** 2026-07-20  
**Scope:** Fulfill user-story tasks T-E1-US-01-03, T-E1-US-01-04 and T-E1-US-01-05.

## Goal

Add intent classification to free-text incoming messages so that expense-like and very-long messages are enqueued for interpretation with an acknowledgment, non-financial messages receive a friendly Spanish guidance reply and are not enqueued, and the four E1-US-01 acceptance scenarios are covered by integration tests.

## Context

- User story: `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-01-send-free-text-to-register-an-expense/E1-US-01 — Send free text to register an expense.md`
- Tasks to close:
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-01-send-free-text-to-register-an-expense/tasks/T-E1-US-01-03.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-01-send-free-text-to-register-an-expense/tasks/T-E1-US-01-04.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-01-send-free-text-to-register-an-expense/tasks/T-E1-US-01-05.md`
- Feature documentation: `docs/features/incoming-message-routing.md`
- Architecture decisions:
  - `docs/adr/ADR-011-two-stage-pipeline.md` — webhook enqueues to `incoming-message`, thin FIFO worker calls `RouteIncomingMessage`, which then enqueues to `process-message` or sends a reply.
  - `docs/adr/adr.md` — ADR-005 async pipeline and ADR-011 FIFO ordering.
- Key source files:
  - `src/application/use-cases/conversation/ClassifyFreeTextExpenseIntent.ts` — existing classifier.
  - `src/application/use-cases/conversation/RouteIncomingMessage.ts` — router to update.
  - `src/application/use-cases/conversation/HandleUnsupportedMessage.ts` — unchanged for unsupported payloads.
  - `src/application/copies/shared.copies.ts` — place for the new guidance copy.
  - `src/application/ports/output/messaging.port.ts` — `MessagingOutputPort` contract.
  - `src/interfaces/http/routes/telegram.webhook.ts` — route that enqueues to `incoming-message`.
  - `src/interfaces/workers/incomingMessage.worker.ts` — thin worker that calls `RouteIncomingMessage`.
  - `src/main.ts` — composition root where new dependencies are wired.
- Existing tests to extend:
  - `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts`
  - `src/interfaces/http/routes/telegram.webhook.spec.ts`

## Public contracts

- **Copies**: new `expenseGuidance(): string` function in `src/application/copies/shared.copies.ts` (Spanish, friendly, actionable).
- **Application service**: new `SendExpenseGuidance` class with `execute(chatId: string): Promise<void>`, depending only on `MessagingOutputPort`.
- **Application service**: `RouteIncomingMessageDeps` gains `classifyFreeTextExpenseIntent: ClassifyFreeTextExpenseIntent` and `sendGuidance: SendExpenseGuidance`. The `execute` method branches on the intent before resolving identity or enqueuing.
- **Test suites**:
  - New `src/application/use-cases/conversation/SendExpenseGuidance.spec.ts`.
  - Updated `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts` with classification routing tests.
  - New integration test file under `src/interfaces/http/routes/` (e.g., `telegram.webhook.integration.spec.ts`) that exercises `POST /webhook/telegram` and the thin-worker routing path.

## Phases

### Phase 1: Add guidance use case and copies

- [x] Add `expenseGuidance()` to `src/application/copies/shared.copies.ts` with the Spanish copy:
  > "¡Hola! Para registrar un gasto escribime el monto y el concepto, por ejemplo: 'Almuerzo 12 euros'."
- [x] Create `src/application/use-cases/conversation/SendExpenseGuidance.ts` that receives `MessagingOutputPort` and sends the guidance copy to a given `chatId`.
- [x] Create `src/application/use-cases/conversation/SendExpenseGuidance.spec.ts` with:
  - Test that `sendMessage` is called once with the correct chat ID and copy.
  - Test that the use case does not throw when the messaging port rejects.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Update `RouteIncomingMessage` to classify and route

- [x] Update `RouteIncomingMessageDeps` in `src/application/use-cases/conversation/RouteIncomingMessage.ts` to include `classifyFreeTextExpenseIntent` and `sendGuidance`.
- [x] In `handleText()`:
  - Classify the text using `ClassifyFreeTextExpenseIntent`.
  - For `expense-like` and `too-long`: keep existing behavior (resolve identity, enqueue to `process-message`, fire-and-forget acknowledgment).
  - For `non-financial`: call `sendGuidance.execute(payload.chatId)`, skip identity resolution, and do not enqueue.
- [x] Preserve existing handling for `UNSUPPORTED` messages and for TEXT payloads without text.
- [x] Wire `ClassifyFreeTextExpenseIntent` and `SendExpenseGuidance` into `RouteIncomingMessage` in `src/main.ts`.
- [x] Update `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts`:
  - Add a mocked classifier and guidance use case.
  - Test that `expense-like` messages resolve identity, enqueue, and send the ack.
  - Test that `too-long` messages resolve identity, enqueue, and send the ack.
  - Test that `non-financial` messages send guidance, do not resolve identity, and do not enqueue.
  - Keep existing tests for missing text and unsupported payloads.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Add integration tests for free-text entry

- [x] Create a new integration test file under `src/interfaces/http/routes/` (`telegram.webhook.integration.spec.ts`).
- [x] Build a test harness that:
  - Creates a Fastify instance with `registerTelegramWebhook`.
  - Mocks `Queue.add` for `incoming-message` so it captures the job data.
  - After the route returns, runs the captured job through the thin worker path (`processIncomingMessageJob`) with a real `RouteIncomingMessage` wired to mocked `messagingPort`, `resolveIdentity`, and `process-message` queue.
  - This respects ADR-011 (the route remains a thin enqueue layer) while still allowing assertions on the final outbound message and the `process-message` job.
- [x] Cover the four acceptance scenarios from E1-US-01:
  - Expense-like text (`"Pagué el almuerzo, 12 euros"`) → HTTP 200, `process-message` job enqueued, ack sent.
  - Partial info (`"Almuerzo 12"`) → HTTP 200, `process-message` job enqueued.
  - Non-financial (`"Hola"`) → HTTP 200, guidance sent, no `process-message` job.
  - Very long message (> 500 characters) → HTTP 200, `process-message` job enqueued.
- [x] Mock the Telegram Bot API HTTP responses if the route/adapters touch the network; otherwise mock the port at the application boundary.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are implemented. Close the loop by checking off the acceptance criteria in the corresponding user-story task files (`T-E1-US-01-03.md`, `T-E1-US-01-04.md`, `T-E1-US-01-05.md`), then ask the user if they want to commit the complete change set.
