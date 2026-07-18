# Fix mapping rejection loop

## Goal

Break the infinite loop that occurs when a user rejects a proposed column mapping by saying "no" or similar. Replace the LLM re-inference fallback with a guided manual-correction flow that lists available columns and invites the user to specify the correct field-to-column assignments.

## Context

### Problem

When the user is in `ONBOARDING_MAPPING` and replies with a rejection intent (e.g., "No"), the current flow:

1. `handleMappingConfirmation` delegates to `CorrectColumnMapping.execute()` because the message is neither a confirmation nor a `list-columns` intent.
2. The parser fails to extract a specific correction.
3. `isRejectMappingIntent` returns `true`, so `CorrectColumnMapping` calls `handleRejection()`.
4. `handleRejection` re-runs LLM column inference against the **same** preview data (same headers and sample rows).
5. The LLM returns the **identical** mapping, which is presented again with the same copy.
6. The user sees the exact same message → infinite loop.

### Files involved

- `src/application/use-cases/spreadsheet/CorrectColumnMapping.ts`: The `handleRejection` method that must stop re-inferring and start guiding the user.
- `src/application/copies/onboarding.copies.ts`: Needs a new `mappingRejectionPrompt(availableColumns)` copy to offer manual correction guidance.
- `src/application/use-cases/spreadsheet/CorrectColumnMapping.spec.ts`: Replace existing re-inference tests with tests for the new rejection-guidance behavior.
- `src/application/copies/onboarding.copies.spec.ts`: Add a test for the new copy.
- `docs/features/confirm-or-correct-column-mapping.md`: Update Scenario 6 (user rejects proposal) and the QA checklist.

### Relevant documentation

- `docs/plans/plan-conventions.md`: Plan structure and conventions.
- `docs/features/confirm-or-correct-column-mapping.md`: Feature rules, contracts, validations, and tests for HU-4.06.
- `docs/features/infer-and-propose-column-mapping.md`: Related feature for HU-4.05 (initial inference flow).

## Phases

### Phase 1: Change rejection flow to guided manual correction

- [x] Modify `CorrectColumnMapping.handleRejection`:
  - Remove the LLM re-inference logic entirely (no calls to `headerDetectionPort`, `llmHeaderDetectionPort`, `llmColumnInferencePort`, or `upsertMany` in this path).
  - Retrieve and decrypt the OAuth token as before; if missing/expired/invalid, return `handleReconnect`.
  - Call `ISpreadsheetColumnPort.listAvailableColumns()` with the decrypted token.
  - Clear any existing transient correction state via `correctionStateRepository.clear(userId)`.
  - Send the new `onboardingCopies.mappingRejectionPrompt(availableColumns)` message.
  - Transition the FSM to `ONBOARDING_MAPPING` keeping the existing `statePayload` (without `mappings` or `unmappedFields` changes) so the user can issue a natural-language correction next.
  - Return `{ kind: 'rejected'; nextState: 'ONBOARDING_MAPPING'; message }`.
- [x] Update `CorrectColumnMappingOutput` union in `CorrectColumnMapping.ts` to add:
  ```ts
  | { kind: 'rejected'; nextState: FsmState; message: string }
  ```
- [x] Add `mappingRejectionPrompt(availableColumns)` to `onboardingCopies`:
  - List available columns with letters and headers.
  - Invite the user to specify field-to-column assignments (e.g., "la categoría está en la columna E").
- [x] Update `CorrectColumnMapping.spec.ts`:
  - Remove or replace tests that assert LLM re-inference on rejection (`re-runs LLM inference when the user rejects the proposal`, `falls back to LLM header detection during rejection re-inference`, `clears step no-header from payload when re-inferred mappings are proposed`, `sends no-header prompt when rejection re-inference cannot locate headers`).
  - Add tests asserting:
    - Rejection intent clears correction state.
    - Rejection intent lists available columns.
    - Rejection intent sends `mappingRejectionPrompt`.
    - Rejection intent stays in `ONBOARDING_MAPPING`.
    - Missing/expired token on rejection still triggers reconnect flow.
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix any issues.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Copy tests and documentation update

- [x] Add a test in `onboarding.copies.spec.ts` for `mappingRejectionPrompt`:
  - Assert that the copy includes the column list and a correction instruction example.
- [x] Update `docs/features/confirm-or-correct-column-mapping.md`:
  - Rewrite **Scenario 6: User rejects the proposal without a specific correction** to describe the new behavior (guided manual correction instead of LLM re-inference).
  - Update the **QA Checklist** under `CorrectColumnMapping use case`:
    - Remove "Rejection without specific correction triggers LLM re-inference and replaces the previous proposal."
    - Remove "Re-inference falls back to LLM header detection when rule-based detection is uncertain."
    - Add "Rejection intent clears correction state and lists available columns for manual correction."
  - Update the **Error Handling** table if needed (re-inference errors are no longer applicable).
- [x] Update `docs/features/README.md` if the feature doc index needs syncing.
- [x] Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Fix any issues.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Public contracts by phase

### Phase 1

- **Application service:** `CorrectColumnMapping.handleRejection` — new behavior (no LLM calls, lists columns, clears state, new output kind).
- **Application DTO:** `CorrectColumnMappingOutput` — new member `{ kind: 'rejected'; ... }`.
- **Text copies:** `onboardingCopies.mappingRejectionPrompt(availableColumns)` — new copy.
- **Test suites:** `CorrectColumnMapping.spec.ts` — replace re-inference tests with rejection-guidance tests.

### Phase 2

- **Test suites:** `onboarding.copies.spec.ts` — new test for `mappingRejectionPrompt`.
- **Documentation:** `docs/features/confirm-or-correct-column-mapping.md` — Scenario 6 and QA checklist updates.

## Next step

All phases are complete. Review the changes and commit if desired.
