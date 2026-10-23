# Align Onboarding FSM Transitions

## Goal

Align the strict FSM transition contract with the onboarding recovery and timeout paths already implemented by the Application layer. Category-stage reconnection and documented onboarding expiration must reach their intended target states without throwing `InvalidStateTransitionError`.

## Context

- Domain transition contract: [`ConversationState.ts`](../../../src/domain/entities/ConversationState.ts) defines all allowed FSM edges through `FSM_TRANSITIONS`.
- Transition validator: [`TransitionConversationState.ts`](../../../src/application/use-cases/conversation/TransitionConversationState.ts) rejects every edge absent from the domain contract before calling the repository.
- Category recovery callers: [`ConfirmCategories.ts`](../../../src/application/use-cases/spreadsheet/ConfirmCategories.ts) and [`ModifyCategoryVocabulary.ts`](../../../src/application/use-cases/spreadsheet/ModifyCategoryVocabulary.ts) request `ONBOARDING_CATEGORIES -> ONBOARDING_START` when spreadsheet configuration is missing.
- Timeout caller: [`HandleExpiredSessions.ts`](../../../src/application/use-cases/conversation/HandleExpiredSessions.ts) sends every generic expired session to `IDLE` through the strict transition validator.
- Persisted onboarding expiration example: [`CorrectColumnMapping.ts`](../../../src/application/use-cases/spreadsheet/CorrectColumnMapping.ts) persists `ONBOARDING_MAPPING` with an expiration timestamp.
- Domain and Application tests: [`ConversationState.spec.ts`](../../../src/domain/entities/ConversationState.spec.ts), [`TransitionConversationState.spec.ts`](../../../src/application/use-cases/conversation/TransitionConversationState.spec.ts), [`ConfirmCategories.spec.ts`](../../../src/application/use-cases/spreadsheet/ConfirmCategories.spec.ts), [`ModifyCategoryVocabulary.spec.ts`](../../../src/application/use-cases/spreadsheet/ModifyCategoryVocabulary.spec.ts), and [`HandleExpiredSessions.spec.ts`](../../../src/application/use-cases/conversation/HandleExpiredSessions.spec.ts).
- Canonical documentation: [`ADR-003`](../../../docs/adr/adr.md#adr-003--estado-conversacional-fsm-persistida-en-postgresql), [`fsm-states.md`](../../../docs/architecture/fsm-states.md), [`conversation-state-management.md`](../../../docs/features/conversation-state-management.md), [`docs/features/README.md`](../../../docs/features/README.md), and [`testing guidelines`](../../../docs/testing/guidelines.md).

The work remains on the existing `fix/saving-expense-bug` branch. No HTTP API, OpenAPI schema, database schema, domain event, user-facing copy, dependency, or migration change is required.

## Phase 1: Restore category-stage reconnection

### Description

Make the existing missing-configuration recovery path valid from `ONBOARDING_CATEGORIES`, so both category confirmation and category modification can return the user to contextual onboarding without failing at the transition boundary.

### To-do actions

- [x] Add `ONBOARDING_START` to `FSM_TRANSITIONS.ONBOARDING_CATEGORIES` while preserving its existing `IDLE` and `ONBOARDING_CATEGORIES` targets.
- [x] Update `ConversationState.spec.ts` to prove `ONBOARDING_CATEGORIES -> ONBOARDING_START` is valid and unrelated category-stage transitions remain rejected.
- [x] Add transition-boundary regression coverage using the real `TransitionConversationState` validator with `ONBOARDING_CATEGORIES` as the persisted source state.
- [x] Retain the existing `ConfirmCategories` and `ModifyCategoryVocabulary` assertions that missing spreadsheet configuration requests `ONBOARDING_START` with `{ promptShown: true }`; strengthen them only as needed to demonstrate that the strict validator accepts the requested recovery edge.
- [x] Update [`fsm-states.md`](../../../docs/architecture/fsm-states.md) with the category reconnection edge and Mermaid diagram path.
- [x] Update [`conversation-state-management.md`](../../../docs/features/conversation-state-management.md) with the category-stage recovery contract, then update [`docs/features/README.md`](../../../docs/features/README.md) as required by the documentation index convention.
- [x] Run the focused Vitest suites for FSM transitions, category confirmation, and category modification, then run the complete `pnpm test` suite. Fix failures without weakening assertions.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Public contracts

- FSM transition contract: `ONBOARDING_CATEGORIES` gains `ONBOARDING_START` as a valid target for missing-configuration recovery.
- Recovery payload contract: existing callers continue to use `{ promptShown: true }`; no Application method signature or user-facing copy changes.
- Test contract: the real transition validator must accept category-stage reconnection while continuing to reject unrelated targets.

## Phase 2: Align onboarding timeout exits

### Description

Allow every documented timeout-capable onboarding state to reach `IDLE` through the generic expired-session handler, preserving strict FSM validation and existing timeout messaging.

### To-do actions

- [x] Add `IDLE` as a valid target for `ONBOARDING_START`, `ONBOARDING_FILE`, `ONBOARDING_SHEET`, `ONBOARDING_VALIDATING_ACCESS`, and `ONBOARDING_MAPPING`; retain the existing `IDLE` targets on `ONBOARDING_DRIVE` and `ONBOARDING_CATEGORIES`.
- [x] Add a parameterized domain contract test covering `ONBOARDING_* -> IDLE` for every onboarding state and keep explicit rejection coverage for unrelated targets.
- [x] Add a `HandleExpiredSessions` regression test that exercises generic onboarding expiration through a real `TransitionConversationState` validator and proves the repository transitions to `IDLE`, clears payload and expiry, sends the existing timeout copy, and emits no invalid-transition error log.
- [x] Preserve the existing two-stage `EXPENSE_REVIEW` timeout and `EXPENSE_UNDO_CONFIRMING` timeout behavior unchanged.
- [x] Update [`fsm-states.md`](../../../docs/architecture/fsm-states.md) so the state table, transition diagram, and timeout section consistently show `IDLE` exits for every onboarding state.
- [x] Update [`conversation-state-management.md`](../../../docs/features/conversation-state-management.md) with the complete onboarding timeout transition set, then update [`docs/features/README.md`](../../../docs/features/README.md) as required by the documentation index convention.
- [x] Run the focused Vitest suites for FSM transitions and expired sessions, then run the complete `pnpm test` suite. Fix failures without weakening assertions.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Public contracts

- FSM timeout contract: every `ONBOARDING_*` state can transition to `IDLE` when its persisted session expires.
- Timeout side-effect contract: expiration clears `statePayload` and `expiresAt`, keeps the existing user-facing timeout copy, and does not bypass the strict transition validator.
- Test contract: parameterized domain coverage and a real-validator Application regression protect the complete onboarding timeout state set.

## Next step

All phases are complete; review and commit the implementation.
