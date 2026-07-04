# Plan: Add onboarding copies for sheet selection flow

## Goal

Add the conversational copy strings for the sheet selection flow and their unit tests, ensuring they match the `HandleSheetSelection` use case acceptance criteria.

## Context

- `src/application/copies/onboarding.copies.ts` - existing copy functions for file selection and partial sheet selection.
- `src/application/copies/onboarding.copies.spec.ts` - existing unit tests for file selection copies; missing sheet selection tests.
- `src/application/use-cases/spreadsheet/HandleSheetSelection.ts` - use case that consumes these copies.
- `src/domain/entities/SheetInfo.ts` - value object used by sheet selection copies.
- `docs/plans/plan-conventions.md` - plan structure conventions.
- `docs/features/select-spreadsheet-file.md` - feature context for onboarding flows.

## Public contracts

- Text copies: `sheetListPrompt`, `singleSheetConfirmation`, `sheetHeaderDescription`, `sheetSelectedConfirmation`, `sheetNotFoundRePrompt`, `sheetMappingTransition`.
- Test suites: `onboarding.copies.spec.ts` (new sheet selection tests).

## Phases

### Phase 1: Update sheet selection copies and add unit tests

Update the existing copy functions in `onboarding.copies.ts` to match the task acceptance criteria, add missing copy functions, and add unit tests for all sheet selection copy functions in `onboarding.copies.spec.ts`.

- [x] Update `sheetListPrompt` to include the "I don't know" option as a numbered list item at the end.
- [x] Add `singleSheetConfirmation(sheetName)` (or rename `singleSheetAutoConfirm` to match the acceptance criteria).
- [x] Add `sheetHeaderDescription(descriptions)` (or adjust `sheetHeadersDescription` to match the acceptance criteria).
- [x] Add `sheetNotFoundRePrompt(sheets)` to return the "not found" message plus the list again.
- [x] Add `sheetMappingTransition()` to return the transition message to structure analysis.
- [x] Keep the existing `sheetSelectedConfirmation` and `sheetIdkPrompt` as they are.
- [x] Add unit tests in `onboarding.copies.spec.ts` for all sheet selection copy functions: `sheetListPrompt`, `singleSheetConfirmation`, `sheetHeaderDescription`, `sheetSelectedConfirmation`, `sheetNotFoundRePrompt`, `sheetMappingTransition`.
- [x] Run `pnpm lint` and `pnpm typecheck`.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases completed. Task acceptance criteria checkboxes updated in `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.03-select-the-records-sheet/tasks/T-4.03-05.md`.
