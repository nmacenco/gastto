# Plan: Auto-list spreadsheet files after OAuth success

## Goal

Make the onboarding flow immediately show the recent-file list right after the user connects Google Drive, so the user does not need to send an extra message to trigger `HandleSpreadsheetFileSelection`.

## Context

- The OAuth callback currently ends after sending the "Google Drive connected" message and transitioning to `ONBOARDING_FILE`. File discovery only happens when the next `process-message` job runs.
- The user's chat log shows the file-list message arriving only after an extra interaction. The expected behavior is that the list appears automatically after the connection success message.
- `HandleSpreadsheetFileSelection` already supports an empty `rawMessage` and no `fileList` in state by running the initial listing path, so it can be reused directly from the callback.
- Relevant prior work: `ai/plans/2026_06_26-fix_onboarding_file_self_transition_and_ack_copy-plan.md` (already allowed `ONBOARDING_FILE` self-transitions and replaced the expense-specific ack copy).
- Documentation to consider:
  - `docs/plans/plan-conventions.md`: plan structure and public-contract rules.
  - `docs/features/select-spreadsheet-file.md`: current file-discovery sequence.
  - `docs/architecture/fsm-states.md`: valid `ONBOARDING_FILE` transitions and payload shape.
- Files involved:
  - `src/application/use-cases/spreadsheet/HandleOAuthCallback.ts`
  - `src/application/use-cases/spreadsheet/HandleOAuthCallback.spec.ts`
  - `src/main.ts`
  - `docs/features/select-spreadsheet-file.md`

## Phases

### Phase 1: Wire file discovery into the OAuth callback

Description: Inject `HandleSpreadsheetFileSelection` into `HandleOAuthCallback` and invoke it immediately after the successful transition to `ONBOARDING_FILE`. Reorder `main.ts` so the file-selection use case is instantiated before the OAuth callback use case. Update unit tests to verify the new delegation.

Public contracts modified:
- `HandleOAuthCallbackDeps`: add `handleSpreadsheetFileSelection: HandleSpreadsheetFileSelection`.

- [x] Add `handleSpreadsheetFileSelection` to `HandleOAuthCallbackDeps` in `src/application/use-cases/spreadsheet/HandleOAuthCallback.ts`.
- [x] After the successful transition to `ONBOARDING_FILE` in `HandleOAuthCallback.execute`, call `this.deps.handleSpreadsheetFileSelection.execute` with `userId`, `externalId`, `channel`, `statePayload: { provider: metadata.provider }`, and `rawMessage: ''`.
- [x] Reorder `src/main.ts` so `handleSpreadsheetFileSelection` is instantiated before `handleOAuthCallback` and passed into its dependencies.
- [x] Update `src/application/use-cases/spreadsheet/HandleOAuthCallback.spec.ts`:
  - add a mock for `handleSpreadsheetFileSelection.execute`,
  - assert it is called in the success path,
  - assert it is NOT called in failure paths.
- [x] Add or update tests covering the file-discovery failure path during callback (the error message should still be sent to the user).
- [x] Run the relevant test suites (`HandleOAuthCallback.spec.ts`, `HandleSpreadsheetFileSelection.spec.ts`) and verify they pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Update documentation

Description: Sync the feature documentation so the file-discovery sequence reflects the automatic listing that now happens immediately after the OAuth callback.

Public contracts modified:
- Text copies / documented behavior in `docs/features/select-spreadsheet-file.md`.

- [x] Update `docs/features/select-spreadsheet-file.md` so the "Initial Listing" sequence says the list is discovered and sent immediately after the OAuth callback succeeds, before any further user message.
- [x] Verify no other docs (e.g., user-stories or ADRs) need updating for this behavior change.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. Review the changes and commit them, or export the conversation and save it alongside the plan.
