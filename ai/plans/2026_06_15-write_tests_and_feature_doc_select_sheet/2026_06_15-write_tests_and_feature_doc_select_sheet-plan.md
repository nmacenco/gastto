# Write Tests and Feature Documentation for Select Sheet

## Goal

Fill the remaining unit test gaps for the Select Sheet feature (HU-4.03), create the canonical feature documentation `docs/features/select-sheet.md`, and update the feature index and data model docs.

## Context

### Relevant Documentation
- `docs/features/TEMPLATE.md`: Feature documentation template
- `docs/features/select-spreadsheet-file.md`: Reference feature doc (closest existing structure)
- `docs/testing/guidelines.md`: Testing conventions (coverage targets, FSM checklist, mock boundaries)
- `docs/architecture/data-model.md`: Current data model documentation (spreadsheet_configs table already documented)
- `docs/adr/adr.md`: ADR-004 (Spreadsheet Adapter), ADR-003 (FSM PostgreSQL), ADR-012 (Copy modules)
- `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.03-select-the-records-sheet/HU-4.03 — Select the records sheet.md`: User story with 5 Gherkin scenarios

### Relevant Source Files
- `src/application/use-cases/spreadsheet/HandleSheetSelection.ts`: Main use case (342 lines)
- `src/application/use-cases/spreadsheet/HandleSheetSelection.spec.ts`: Existing tests (19 `it` blocks, 475 lines)
- `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts`: Adapter (178 lines)
- `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.spec.ts`: Existing tests (16 `it` blocks, 263 lines)
- `src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.ts`: Repository (77 lines)
- `src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.spec.ts`: Existing tests (6 `it` blocks, 162 lines)
- `src/interfaces/workers/message.worker.ts`: Worker routing (ONBOARDING_SHEET case, lines 133-146)
- `src/interfaces/workers/message.worker.spec.ts`: Existing tests (2 ONBOARDING_SHEET tests, lines 388-429)
- `src/domain/entities/SheetInfo.ts`: Value object
- `src/domain/entities/SheetInfo.spec.ts`: Existing tests (9 `it` blocks, 91 lines)
- `src/application/copies/onboarding.copies.ts`: Copy functions
- `src/application/copies/onboarding.copies.spec.ts`: Copy tests (241 lines)

### Current State
- **5 test files** with **52 test blocks** already cover all 5 Gherkin scenarios, error paths, and domain validation.
- **Missing unit test gaps:** generic `Error` during `getHeaders` in IDK path, empty `rawMessage`, selection `"0"`, whitespace-heavy input, malformed parser items in `listSheets`, error body parsing failure in `fetch` responses.
- **Feature documentation `docs/features/select-sheet.md` does NOT exist.** This is the primary blocking gap per the "No doc = blocked" rule.
- **`docs/features/README.md`** has only 2 entries and needs updating.
- **`docs/architecture/data-model.md`** documents the `spreadsheet_configs` table but does not mention the Option A convention (placeholder `accessVerifiedAt` at creation, real verification in HU-4.04).

### Public Contracts
- **Test suites:** `HandleSheetSelection.spec.ts`, `GoogleSheetsAdapter.spec.ts`, `DrizzleSpreadsheetConfigRepository.spec.ts`, `message.worker.spec.ts`
- **Text copies:** `onboarding.copies.ts` (already tested, no changes)
- **Documentation:** `docs/features/select-sheet.md` (new), `docs/features/README.md` (update), `docs/architecture/data-model.md` (update)

## Phases

### Phase 1: Unit test gap coverage

**Description:** Fill the remaining unit test gaps in the Select Sheet feature test files. Add edge-case tests for parser branches, error handling branches, and input validation that are not yet covered.

**To-do actions:**

- [ ] Add `it` block in `HandleSheetSelection.spec.ts` for generic `Error` thrown during `getHeaders` in the "I don't know" flow (currently only `SpreadsheetError` is tested).
- [ ] Add `it` block in `HandleSheetSelection.spec.ts` for `rawMessage: ''` (empty string) when `sheetList` is present in payload.
- [ ] Add `it` block in `HandleSheetSelection.spec.ts` for selection `"0"` (invalid 1-based index, should re-prompt).
- [ ] Add `it` block in `HandleSheetSelection.spec.ts` for whitespace-heavy input like `"  2  "` and `"  Resumen  "`.
- [ ] Add `it` block in `GoogleSheetsAdapter.spec.ts` for malformed item in `listSheets` response (null item, missing `properties`, empty `title`).
- [ ] Add `it` block in `GoogleSheetsAdapter.spec.ts` for non-array first row in `getHeaders` response.
- [ ] Add `it` block in `GoogleSheetsAdapter.spec.ts` for mixed-type cell values in `getHeaders` response.
- [ ] Add `it` block in `GoogleSheetsAdapter.spec.ts` for error body parsing failure in `listSheets` (non-2xx response where `response.json()` throws).
- [ ] Add `it` block in `GoogleSheetsAdapter.spec.ts` for error body parsing failure in `getHeaders` (non-2xx response where `response.json()` throws).
- [ ] Run `pnpm test` and verify all tests pass.
- [ ] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Feature documentation and index updates

**Description:** Create the canonical `docs/features/select-sheet.md` following the evolved feature doc structure (matching `select-spreadsheet-file.md`), update the feature index, and document the Option A convention in the data model docs.

**To-do actions:**

- [ ] Create `docs/features/select-sheet.md` with the following sections:
  - `## Overview`: What the feature does and its position in the onboarding flow.
  - `## Scope`: In-scope and out-of-scope bullets.
  - `## FSM States`: Table with `State`, `Description`, `Next` columns for `ONBOARDING_SHEET`.
  - `## Flow Sequence`: Numbered steps covering initial listing (single sheet auto-confirm, multi-sheet prompt), selection by number, fuzzy name match, "I don't know" header description, invalid name re-prompt.
  - `## Adapters`: List `GoogleSheetsAdapter` and `SpreadsheetPort`.
  - `## Configuration`: Env vars (none required beyond existing OAuth token).
  - `## API Contracts`: TypeScript interfaces for `HandleSheetSelectionInput`, `HandleSheetSelectionOutput`, `HandleSheetSelectionDeps`, `SpreadsheetPort`, `SheetInfo`.
  - `## Error Handling`: Table mapping scenarios (token expired, API failure, invalid selection, missing fileId) to behaviors.
  - `## QA Checklist`: Checkbox list covering all 5 Gherkin scenarios + error paths + OneDrive placeholder.
- [ ] Update `docs/features/README.md` to add the `select-sheet.md` entry.
- [ ] Update `docs/architecture/data-model.md` to add the Option A convention note: `spreadsheet_configs.accessVerifiedAt` is initialized as a placeholder during sheet selection (HU-4.03); real read/write validation happens in HU-4.04.
- [ ] Run `pnpm test` and verify all tests pass.
- [ ] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next Step

Complete Phase 1 (unit test gap coverage) first.
