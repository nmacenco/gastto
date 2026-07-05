# Plan: Implement FSM Eager Advance for Sheet Selection and Access Validation

## Goal

Wire the two missing eager-advance transitions documented in ADR-014 so the onboarding flow does not stall after the user selects a sheet. `HandleSheetSelection` will auto-trigger `ValidateSpreadsheetAccess`, and `ValidateSpreadsheetAccess` will auto-trigger `InferColumnMapping` on success, eliminating the current "dead air" where `column_mappings` stays empty.

## Context

- ADR-014 (`docs/adr/ADR-014-fsm-eager-advance.md`) defines the eager-advance pattern: when a use case performs a deterministic forward FSM transition, it must invoke the next use case immediately after persisting the new state, with `rawMessage: ''`, wrapped in an isolated `try/catch`.
- The pattern is already implemented for the first two onboarding steps:
  - `HandleOAuthCallback` invokes `HandleSpreadsheetFileSelection` after transitioning to `ONBOARDING_FILE` (`src/application/use-cases/spreadsheet/HandleOAuthCallback.ts:185-202`).
  - `HandleSpreadsheetFileSelection.triggerSheetSelection` invokes `HandleSheetSelection` after transitioning to `ONBOARDING_SHEET` (`src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts:448-475`).
- The pattern is **missing** for the last two deterministic transitions:
  - `ONBOARDING_SHEET` → `ONBOARDING_VALIDATING_ACCESS`: `HandleSheetSelection.confirmSheet` transitions but does not invoke `ValidateSpreadsheetAccess` (`src/application/use-cases/spreadsheet/HandleSheetSelection.ts:407-447`).
  - `ONBOARDING_VALIDATING_ACCESS` → `ONBOARDING_MAPPING`: `ValidateSpreadsheetAccess` on `success` transitions but does not invoke `InferColumnMapping` (`src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts:103-130`).
- Because `message.worker.ts` processes one job per incoming user message and does not re-dispatch after a state transition, the FSM reaches `ONBOARDING_VALIDATING_ACCESS` and waits forever for a user message that never comes. As a result `ValidateSpreadsheetAccess` never runs, `InferColumnMapping` never runs, and nothing is inserted into `column_mappings`.
- Documentation reference:
  - `docs/adr/ADR-014-fsm-eager-advance.md`: the decision, rules, and applicable transitions.
  - `docs/architecture/fsm-states.md`: state table and eager-advance list.
  - `docs/features/select-sheet.md`: currently states the next state is `ONBOARDING_MAPPING`, which is wrong; the code transitions to `ONBOARDING_VALIDATING_ACCESS`.
  - `docs/features/validate-spreadsheet-access.md`: behavior of the validation step.
  - `docs/plans/plan-conventions.md`: plan structure and public-contract rules.
- Files involved:
  - `src/application/use-cases/spreadsheet/HandleSheetSelection.ts`: add `ValidateSpreadsheetAccess` dependency and eager-advance call.
  - `src/application/use-cases/spreadsheet/HandleSheetSelection.spec.ts`: cover the new behavior.
  - `src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts`: add `InferColumnMapping` dependency and eager-advance call on `success`.
  - `src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.spec.ts`: cover the new behavior.
  - `src/main.ts`: reorder instantiation so `validateSpreadsheetAccess` is built before `handleSheetSelection`, and `inferColumnMapping` before `validateSpreadsheetAccess`.
  - `docs/features/select-sheet.md`: correct the documented next state.
  - `docs/features/validate-spreadsheet-access.md`: document the eager advance to `ONBOARDING_MAPPING`.

## Phases

### Phase 1: Eager advance from sheet selection to access validation

Description: Make `HandleSheetSelection` invoke `ValidateSpreadsheetAccess` immediately after it transitions to `ONBOARDING_VALIDATING_ACCESS`, so the user receives validation feedback (success silently continues, read-only warning, empty-sheet confirmation, reconnect prompt) without having to send another message.

- [x] Add `validateSpreadsheetAccess: ValidateSpreadsheetAccess` to the `HandleSheetSelectionDeps` interface in `src/application/use-cases/spreadsheet/HandleSheetSelection.ts`.
- [x] In `HandleSheetSelection.confirmSheet`, after `transitionState.execute({ targetState: 'ONBOARDING_VALIDATING_ACCESS', payload })`, invoke the new dependency via a private `triggerAccessValidation(userId, externalId, channel, payload)` helper that calls `this.deps.validateSpreadsheetAccess.execute({ userId, externalId, channel, statePayload: payload })` wrapped in `try/catch` with a structured log using code `POST_SHEET_VALIDATING_ACCESS_FAILED`. (`ValidateSpreadsheetAccessInput` has no `rawMessage` field, so it is omitted.)
- [x] Reorder instantiation in `src/main.ts` so `validateSpreadsheetAccess` is constructed before `handleSheetSelection`, and pass `validateSpreadsheetAccess` into the `HandleSheetSelection` constructor.
- [x] Update `src/application/use-cases/spreadsheet/HandleSheetSelection.spec.ts`:
  - Add a `validateSpreadsheetAccess` mock to the shared deps fixture.
  - Assert that `confirmSheet` (single-sheet auto-confirm path and number/name selection paths) invokes `validateSpreadsheetAccess.execute` with the persisted payload.
  - Assert that a thrown error from `validateSpreadsheetAccess.execute` is logged and does not change the returned `nextState: 'ONBOARDING_VALIDATING_ACCESS'` nor prevent the confirmation message from being sent.
  - Assert that `handleReconnect`, `handleIdk`, invalid selection, and empty-sheet-confirm paths do **not** invoke `validateSpreadsheetAccess`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Run `pnpm test` and verify the affected suites pass. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Eager advance from access validation to column mapping inference

Description: Make `ValidateSpreadsheetAccess` invoke `InferColumnMapping` immediately after a `success` result transitions the FSM to `ONBOARDING_MAPPING`, so the user receives the column-mapping proposal without having to send another message. Non-success outcomes (read-only, empty-sheet, access-error) must not trigger inference.

- [x] Add `inferColumnMapping: InferColumnMapping` to the `ValidateSpreadsheetAccessDeps` interface in `src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts`. (Also added `logger: Logger` for the structured log.)
- [x] In the `success` branch of `handleResult`, after `transitionState.execute({ targetState: 'ONBOARDING_MAPPING', payload })`, invoke the new dependency via a private `triggerColumnInference(userId, externalId, channel, payload)` helper that calls `this.deps.inferColumnMapping.execute({ userId, externalId, channel, statePayload: payload })` wrapped in `try/catch` with a structured log using code `POST_VALIDATING_ACCESS_MAPPING_FAILED`. (`InferColumnMappingInput` has no `rawMessage` field, so it is omitted.)
- [x] Confirm that the `read-only`, `empty-sheet`, and `access-error` branches do **not** invoke `inferColumnMapping`.
- [x] Reorder instantiation in `src/main.ts` so `inferColumnMapping` is constructed before `validateSpreadsheetAccess`, and pass `inferColumnMapping` (and `logger`) into the `ValidateSpreadsheetAccess` constructor.
- [x] Update `src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.spec.ts`:
  - Add an `inferColumnMapping` mock (and `logger` mock) to the shared deps fixture.
  - Assert that the `success` path invokes `inferColumnMapping.execute` with the persisted payload (including the serialized preview).
  - Assert that a thrown error from `inferColumnMapping.execute` is logged and does not change the returned `nextState: 'ONBOARDING_MAPPING'` nor prevent `accessVerifiedAt` from being updated.
  - Assert that `read-only`, `empty-sheet`, `access-error`, and token-missing paths do **not** invoke `inferColumnMapping`.
- [x] Update `tests/integration/validate-spreadsheet-access/ValidateSpreadsheetAccess.integration.spec.ts` to inject mock `inferColumnMapping` and `logger` into each `ValidateSpreadsheetAccess` construction.
- [x] Update `docs/features/select-sheet.md`: correct the state table and flow sequence so the next state after sheet confirmation is `ONBOARDING_VALIDATING_ACCESS` (not `ONBOARDING_MAPPING`), and document that `HandleSheetSelection` eagerly invokes `ValidateSpreadsheetAccess`.
- [x] Update `docs/features/validate-spreadsheet-access.md`: document that on `success` the use case eagerly invokes `InferColumnMapping` per ADR-014.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Run `pnpm test` and verify the full suite passes. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Both phases are complete. Review the changes and commit them, or export the conversation and save it alongside the plan.