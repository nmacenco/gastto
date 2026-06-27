# Plan: Auto-list sheets after spreadsheet file selection

## Goal

Make the file-selection flow immediately trigger sheet discovery (or single-sheet auto-confirmation) right after the user selects a spreadsheet file, so the user does not need to send an extra message to trigger `HandleSheetSelection`.

## Context

- `HandleSpreadsheetFileSelection` currently transitions to `ONBOARDING_SHEET` after a successful file selection and sends a confirmation message, then waits for the next incoming message before `message.worker` routes to `HandleSheetSelection`.
- The chat log shows the confirmation message "Elegiste *...*. Ahora vamos a seleccionar la hoja dentro del archivo." followed by silence until the user sends another message.
- `HandleSheetSelection` already supports an empty `rawMessage` and no `sheetList` in state by running the initial listing path, so it can be reused directly from the file-selection use case.
- Relevant prior work: `ai/plans/2026_06_27-auto_list_files_after_oauth_success/2026_06_27-auto_list_files_after_oauth_success-plan.md` (already wired `HandleSpreadsheetFileSelection` into `HandleOAuthCallback`).
- Documentation to consider:
  - `docs/plans/plan-conventions.md`: plan structure and public-contract rules.
  - `docs/features/select-spreadsheet-file.md`: current file-selection sequence.
  - `docs/features/select-sheet.md`: current sheet-selection sequence.
- Files involved:
  - `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts`
  - `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.spec.ts`
  - `src/main.ts`
  - `docs/features/select-spreadsheet-file.md`
  - `docs/features/select-sheet.md`

## Phases

### Phase 1: Wire sheet discovery into file selection

Description: Inject `HandleSheetSelection` into `HandleSpreadsheetFileSelection` and invoke it immediately after every successful transition to `ONBOARDING_SHEET`. Include `provider` in the `ONBOARDING_SHEET` payload so `HandleSheetSelection` receives complete state. Reorder `main.ts` so `HandleSheetSelection` is instantiated before `HandleSpreadsheetFileSelection`. Update unit tests to verify the new delegation and its failure path.

Public contracts modified:
- `HandleSpreadsheetFileSelectionDeps`: add `handleSheetSelection: HandleSheetSelection`.
- FSM payload to `ONBOARDING_SHEET`: include `provider` alongside `selectedFileId` and `selectedFileName`.
- Test suites: `HandleSpreadsheetFileSelection.spec.ts` new delegation and error-path cases.

- [x] Add `handleSheetSelection` to `HandleSpreadsheetFileSelectionDeps` in `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts`.
- [x] In `HandleSpreadsheetFileSelection.execute`, update the `ONBOARDING_SHEET` payload in `handleNumberSelection` and `handleDirectUrl` to include `provider`.
- [x] After the successful transition to `ONBOARDING_SHEET` in both `handleNumberSelection` and `handleDirectUrl`, call `this.deps.handleSheetSelection.execute` with `userId`, `externalId`, `channel`, `statePayload: { selectedFileId, selectedFileName, provider }`, and `rawMessage: ''`.
- [x] Wrap the delegated `handleSheetSelection.execute` call in a `try/catch` that logs a structured error (endpoint `HandleSpreadsheetFileSelection`, code `POST_SELECTION_SHEET_DISCOVERY_FAILED`) without changing the successful return value of the file-selection use case.
- [x] Reorder `src/main.ts` so `handleSheetSelection` is instantiated before `handleSpreadsheetFileSelection` and passed into its dependencies.
- [x] Update `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.spec.ts`:
  - add a mock for `handleSheetSelection.execute`,
  - assert it is called in the number-selection success path with the expected payload,
  - assert it is called in the direct-URL success path with the expected payload,
  - assert it is NOT called in the initial listing, search, "none of these", and error paths,
  - add a test covering the sheet-discovery failure path during callback (the file-selection result should still be successful and an error should be logged).
- [x] Run the relevant test suites (`HandleSpreadsheetFileSelection.spec.ts`, `HandleSheetSelection.spec.ts`) and verify they pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Update documentation

Description: Sync the feature documentation so the file-selection sequence reflects the automatic sheet listing (or single-sheet auto-confirmation) that now happens immediately after a spreadsheet file is chosen.

Public contracts modified:
- Text copies / documented behavior in `docs/features/select-spreadsheet-file.md` and `docs/features/select-sheet.md`.

- [x] Update `docs/features/select-spreadsheet-file.md` so the "Selection by Number" and "Direct URL Validation" sequences state that `HandleSheetSelection` is invoked automatically after transitioning to `ONBOARDING_SHEET`, before any further user message.
- [x] Update `docs/features/select-sheet.md` so the "Initial Listing" sequence notes it can be triggered automatically from `HandleSpreadsheetFileSelection` in addition to being triggered by the next user message.
- [x] Verify no other docs (e.g., user-stories or ADRs) need updating for this behavior change.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. Review the changes and commit them, or export the conversation and save it alongside the plan.
