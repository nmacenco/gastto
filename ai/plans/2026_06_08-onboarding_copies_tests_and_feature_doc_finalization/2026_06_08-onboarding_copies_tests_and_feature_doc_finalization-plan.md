# Plan: Onboarding copies tests and feature doc finalization

## Goal

Add unit tests for all file-selection onboarding copy functions and update the canonical feature documentation to explicitly document the `statePayload` storage contract for the selected spreadsheet file.

## Context

- **Copies already implemented:** `src/application/copies/onboarding.copies.ts` contains all 7 file-selection copy functions (`fileListPrompt`, `noFilesFoundPrompt`, `fileSelectedConfirmation`, `invalidSelectionRePrompt`, `searchByNamePrompt`, `urlValidationFailed`, `urlValidationSuccess`). These were delivered as part of T-4.02-03 (use case implementation) but T-4.02-05 formally owns their acceptance criteria.
- **Tests already exist for:**
  - `HandleSpreadsheetFileSelection.spec.ts` — application use case with mocked ports.
  - `GoogleDriveFileDiscoveryAdapter.spec.ts` — adapter with mocked `fetch`.
  - `message.worker.spec.ts` — ONBOARDING_FILE branch (wired + fallback).
- **Feature doc already exists:** `docs/features/select-spreadsheet-file.md` covers the full flow, but T-4.02-06 requires an explicit note about `statePayload` storage until HU-4.04.
- **Conventions to follow:**
  - `docs/plans/plan-conventions.md` — plan structure and English writing style.
  - `docs/testing/guidelines.md` — testing rules, coverage targets, FSM checklist.
  - Existing copy functions use pure arrow functions returning strings; tests should assert exact output formatting.

## Public Contracts

| Contract Type  | Phase | Details                                                                                                   |
| -------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| **Test Suite** | 1     | `src/application/copies/onboarding.copies.spec.ts` — unit tests for all 7 file-selection copy functions   |
| **Document**   | 1     | `docs/features/select-spreadsheet-file.md` — add explicit note about `statePayload` storage until HU-4.04 |

## Phases

### Phase 1: Add copy unit tests and finalize feature documentation

**Description:** Create unit tests for all file-selection onboarding copy functions, and update the canonical feature doc to explicitly document the `statePayload` storage contract.

- [x] Create `src/application/copies/onboarding.copies.spec.ts` with Vitest tests covering:
  - `fileListPrompt(files)`: asserts numbered list format, file names present, "None of these / search by name" option appended.
  - `noFilesFoundPrompt()`: asserts output contains guidance text.
  - `fileSelectedConfirmation(fileName)`: asserts file name appears with bold Markdown formatting.
  - `invalidSelectionRePrompt(fileCount)`: asserts range formatting (1 to N, N+1 option).
  - `searchByNamePrompt()`: asserts prompt text.
  - `urlValidationFailed()`: asserts permission/error message.
  - `urlValidationSuccess(fileName)`: asserts file name appears with bold formatting.
- [x] Update `docs/features/select-spreadsheet-file.md` to add an explicit note: the selected file is stored in `conversationStates.statePayload` until HU-4.04 creates the definitive `spreadsheet_configs` record.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Full validation and task closure

**Description:** Run the complete test suite and update the task files to mark acceptance criteria as complete.

- [x] Run `pnpm test` to verify all tests pass green.
- [x] Run `pnpm lint` and `pnpm typecheck` again to confirm clean build.
- [x] Update `docs/user-stories/01-mvp/01-Vinculacion de planilla - Release 1 MVP/HU-4.02-select-the-spreadsheet-file/tasks/T-4.02-05.md` — check off completed acceptance criteria.
- [x] Update `docs/user-stories/01-mvp/01-Vinculacion de planilla - Release 1 MVP/HU-4.02-select-the-spreadsheet-file/tasks/T-4.02-06.md` — check off completed acceptance criteria.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. The plan is fully implemented. Consider committing the changes and exporting the conversation as `ai/plans/2026_06_08-onboarding_copies_tests_and_feature_doc_finalization/2026_06_08-onboarding_copies_tests_and_feature_doc_finalization-conversation.md`.
