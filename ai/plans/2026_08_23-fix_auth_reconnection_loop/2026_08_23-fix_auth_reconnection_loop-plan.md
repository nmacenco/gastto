# Fix Authorization Reconnection Loop

## Goal

Restore the documented recovery path after an expense save fails with `AUTH_ERROR`. A user's next `empezar` message must start a fresh Google OAuth flow instead of being treated as non-financial text, without automatically replaying the failed expense.

## Context

- Save-failure orchestration: [`ResolveExpenseSummaryActionUseCase.ts`](../../../src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts) currently transitions every non-retryable failure from `EXPENSE_SAVING` to `IDLE` before sending the authorization recovery copy.
- Incoming-message routing: [`RouteIncomingMessage.ts`](../../../src/application/use-cases/conversation/RouteIncomingMessage.ts) classifies text in `IDLE` and sends generic expense guidance for non-financial messages such as `empezar`.
- Onboarding dispatch: [`message.worker.ts`](../../../src/interfaces/workers/message.worker.ts) delegates `empezar` to the cloud-connection use case only while the FSM is in `ONBOARDING_START` with its provider prompt already shown.
- Google connection entry point: [`InitiateCloudConnection.ts`](../../../src/application/use-cases/spreadsheet/InitiateCloudConnection.ts) already accepts `empezar` as a Google provider-selection alias and generates the OAuth link.
- FSM contract: [`ConversationState.ts`](../../../src/domain/entities/ConversationState.ts) does not currently permit `EXPENSE_SAVING` to transition directly to `ONBOARDING_START`.
- User-facing copy: [`expense.copies.ts`](../../../src/application/copies/expense.copies.ts) already instructs the user to respond with `empezar`; this exact copy remains unchanged.
- Canonical behavior and architecture: [`expense-confirmation.md`](../../../docs/features/expense-confirmation.md), [`conversation-state-management.md`](../../../docs/features/conversation-state-management.md), [`fsm-states.md`](../../../docs/architecture/fsm-states.md), [`ADR-003`](../../../docs/adr/adr.md#adr-003--estado-conversacional-fsm-persistida-en-postgresql), and [`error-taxonomy.md`](../../../docs/architecture/error-taxonomy.md).
- Testing conventions: [`testing guidelines`](../../../docs/testing/guidelines.md).

No HTTP API, OpenAPI schema, database schema, domain event, dependency, or migration change is required. The failed expense must not be replayed automatically after reconnection because the current recovery contract starts a fresh authorization flow and automatic replay could create duplicate writes.

## Phase 1: Restore the authorization recovery path

### Description

Deliver the complete `AUTH_ERROR -> ONBOARDING_START -> empezar -> ONBOARDING_DRIVE` vertical slice, prove it at domain, Application, and routing boundaries, and align the canonical FSM documentation in the same change.

### To-do actions

- [x] Extend `FSM_TRANSITIONS.EXPENSE_SAVING` to allow `ONBOARDING_START`, while preserving the existing `IDLE` and `EXPENSE_SAVING_RETRY` transitions.
- [x] Update the `AUTH_ERROR` branch in `ResolveExpenseSummaryActionUseCase` to transition directly to `ONBOARDING_START` with `statePayload: { promptShown: true }` before sending the existing `saveAuthorizationFailure()` copy. Keep `STRUCTURE_ERROR`, `UNKNOWN`, and retryable network behavior unchanged.
- [x] Preserve the current user-facing authorization failure copy exactly: `No pude acceder a tu planilla. Respondé *empezar* para volver a conectar tu cuenta.`
- [x] Keep the confirmed but failed expense out of the onboarding payload and do not automatically retry or replay it after OAuth completion.
- [x] Update `ConversationState.spec.ts` to verify that `EXPENSE_SAVING -> ONBOARDING_START` is valid and that unrelated FSM transitions remain rejected.
- [x] Update `ResolveExpenseSummaryActionUseCase.spec.ts` to verify that `AUTH_ERROR` enters `ONBOARDING_START` with `promptShown: true`, retains the existing copy, emits no save-success confirmation, and does not advance a pending expense.
- [x] Add a routing/worker regression test that starts from the persisted authorization-recovery state, submits `empezar`, delegates exactly once to `InitiateCloudConnection`, produces the Google OAuth path to `ONBOARDING_DRIVE`, and never sends generic expense guidance or invokes expense interpretation.
- [x] Retain focused coverage proving that `empezar` remains non-financial in ordinary `IDLE` conversations so the recovery behavior stays contextual to the FSM.
- [x] Update [`fsm-states.md`](../../../docs/architecture/fsm-states.md) with the new authorization-recovery transition, diagram edge, and `promptShown: true` recovery payload semantics.
- [x] Update [`conversation-state-management.md`](../../../docs/features/conversation-state-management.md) and [`expense-confirmation.md`](../../../docs/features/expense-confirmation.md) so their transition tables and recovery behavior explicitly match the implementation, then update [`docs/features/README.md`](../../../docs/features/README.md) as required by the documentation index convention.
- [x] Run the focused Vitest suites for conversation state, save-failure orchestration, message routing, and onboarding initiation, then run the complete `pnpm test` suite. Fix failures without weakening assertions.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Public contracts

- FSM transition contract: `EXPENSE_SAVING` gains `ONBOARDING_START` as a valid target specifically for terminal authorization failures.
- Authorization-recovery state payload: `{ promptShown: true }`, allowing the already-requested `empezar` reply to be consumed immediately by the existing onboarding handler.
- Text command behavior: `empezar` starts Google OAuth only in the contextual `ONBOARDING_START` recovery state; ordinary `IDLE` behavior is unchanged.
- User-facing copy: the existing authorization failure message remains byte-for-byte unchanged.
- Test contract: regression coverage proves the full `AUTH_ERROR -> empezar -> OAuth` path and the absence of generic guidance, expense interpretation, save-success messaging, pending-expense advancement, and automatic expense replay.

## Next step

All phases are complete; review the implementation and optionally commit the verified changes.
