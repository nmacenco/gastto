# Plan: Fix onboarding loop with state-aware incoming message routing

**Plan file:** `ai/plans/2026_07_20-fix_onboarding_loop_state_aware_routing/2026_07_20-fix_onboarding_loop_state_aware_routing-plan.md`
**Date:** 2026-07-20
**Scope:** Fix the conversational loop where non-financial replies during active onboarding (e.g. confirming or correcting column mapping) are misclassified and never reach the FSM worker.

## Goal

Make `RouteIncomingMessage` aware of the user's current FSM state so that any text message received while the user is in an active onboarding or expense flow is enqueued to the thick worker. Only when the user is truly idle should the intent classifier decide between starting a new expense flow and sending guidance.

## Context

- **Bug root cause:** `RouteIncomingMessage` runs `ClassifyFreeTextExpenseIntent` before checking the conversation state. During `ONBOARDING_MAPPING`, replies such as `"sí"`, `"no"`, or `"método de pago columna A"` are classified as `non-financial`, so the friendly guidance copy is returned and the message is never enqueued to `process-message`. The FSM remains stuck in `ONBOARDING_MAPPING`, creating the loop reported by the user.
- **Current happy-path expectation:** `ONBOARDING_MAPPING` + confirm mapping → `ONBOARDING_CATEGORIES` → confirm categories → `IDLE` → free-text expense registration.
- **Relevant source files:**
  - `src/application/use-cases/conversation/RouteIncomingMessage.ts` — the router to update.
  - `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts` — unit tests.
  - `src/interfaces/http/routes/telegram.webhook.integration.spec.ts` — integration tests.
  - `src/main.ts` — composition root; wires `RouteIncomingMessage` dependencies.
  - `src/domain/entities/ConversationState.ts` — FSM states and transitions.
  - `src/application/use-cases/conversation/GetConversationState.ts` — state reader to inject.
- **Relevant documentation:**
  - `docs/plans/plan-conventions.md` — plan structure and conventions.
  - `docs/features/incoming-message-routing.md` — feature behavior to update.
  - `docs/adr/ADR-011-two-stage-pipeline.md` — pipeline design context.
  - `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.02-receive-parse-and-route-incoming-messages/HU-0.02 — Receive, Parse and Route Incoming Messages.md`
  - `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.05-infer-and-propose-column-mapping/HU-4.05 — Infer and propose column mapping.md`

## Public contracts

- **Application service:** `RouteIncomingMessageDeps` gains `getConversationState: GetConversationState`.
- **Application service behavior:**
  - Resolve user identity first.
  - Load the current conversation state.
  - If the state is `IDLE` or `EXPENSE_RECEIVING`, classify the text and apply the existing routing (expense-like / too-long → enqueue + ack; non-financial → guidance).
  - If the state is any other FSM state (e.g. `ONBOARDING_MAPPING`, `ONBOARDING_CATEGORIES`, `EXPENSE_REVIEW`, `EXPENSE_CLARIFYING`), enqueue the message to `process-message` and send the acknowledgment, bypassing the intent classifier.
- **Test suites:**
  - Update `RouteIncomingMessage.spec.ts` with state-aware routing cases for `IDLE`, `EXPENSE_RECEIVING`, and active onboarding states.
  - Update `telegram.webhook.integration.spec.ts` with an integration scenario where the user is in `ONBOARDING_MAPPING` and sends a non-financial reply; the message must be enqueued to `process-message`.
- **Text copies:** No changes.
- **Database schemas:** No changes.

## Phases

### Phase 1: Core routing fix and unit tests

Make the router read the conversation state before classifying intent, and cover the new behavior with unit tests.

- [x] Add `getConversationState: GetConversationState` to `RouteIncomingMessageDeps` in `src/application/use-cases/conversation/RouteIncomingMessage.ts`.
- [x] Refactor `handleText()` to:
  - resolve user identity first;
  - load the current conversation state;
  - if state is `IDLE` or `EXPENSE_RECEIVING`, keep the existing classification-based routing;
  - for any other state, enqueue the raw text to `process-message` and send the acknowledgment, ignoring the classifier.
- [x] Wire `GetConversationState` into `RouteIncomingMessage` in `src/main.ts`.
- [x] Update `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts`:
  - Add tests for `IDLE`/`EXPENSE_RECEIVING` preserving the existing guidance behavior for non-financial text.
  - Add tests for `ONBOARDING_MAPPING`, `ONBOARDING_CATEGORIES`, and `EXPENSE_REVIEW` where non-financial text is enqueued and ack is sent.
  - Keep existing tests for unsupported payloads and missing text.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly to the next phase.

### Phase 2: Integration tests and feature documentation

Close the loop with an integration test that exercises the full pipeline from Telegram webhook to `process-message` job while the user is in an active onboarding state, and update the feature documentation.

- [x] Update `src/interfaces/http/routes/telegram.webhook.integration.spec.ts`:
  - Add a test where the mocked `resolveIdentity` returns a user whose conversation state is `ONBOARDING_MAPPING`.
  - Send a non-financial reply (e.g. `"sí"` or `"método de pago columna A"`).
  - Assert that the route returns HTTP 200, the `process-message` job is enqueued, and the guidance copy is **not** sent.
- [x] Update `docs/features/incoming-message-routing.md`:
  - Document that the router checks the FSM state before classifying intent.
  - List the states that bypass intent classification and go straight to the thick worker.
  - Keep the existing pipeline diagram and behavior descriptions.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly to the next phase.

## Next step

Both phases are complete. Review the diff and decide whether to commit the changes now.
