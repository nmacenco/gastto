# Goal

Implement the `HandleSheetSelection` use case in the Application layer to orchestrate the `ONBOARDING_SHEET` FSM state. The use case discovers available sheets via `SpreadsheetPort`, handles all 5 Gherkin scenarios (single-sheet auto-confirmation, numbered list selection, fuzzy name matching, "I don't know" with header-based descriptions, and invalid-name re-prompts), persists the selected sheet via `ISpreadsheetConfigRepository`, and transitions the FSM to `ONBOARDING_MAPPING`.

# Context

- **Task file:** `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.03-select-the-records-sheet/tasks/T-4.03-04.md`
- **User story:** `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.03-select-the-records-sheet/HU-4.03 — Select the records sheet.md`
- **Existing similar use case:** `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts` serves as the reference pattern for token retrieval, state branching, and FSM transitions.
- **FSM states:** `ONBOARDING_SHEET` and `ONBOARDING_MAPPING` are already defined in `src/domain/entities/ConversationState.ts`.
- **Ports:** `SpreadsheetPort` (with `listSheets` and `getHeaders`) exists in `src/domain/ports/services.ts`. `ISpreadsheetConfigRepository` is defined in `src/domain/ports/repositories.ts` and implemented in `src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.ts`.
- **Worker placeholder:** `src/interfaces/workers/message.worker.ts` currently sends a placeholder for `ONBOARDING_SHEET`.
- **Design gap:** `GoogleSheetsAdapter` takes `accessToken` in its constructor, so a new `SpreadsheetPortFactory` domain port is required to create a port instance per-request after decrypting the token.
- **Copies:** `src/application/copies/onboarding.copies.ts` contains the text strings for onboarding messages; new sheet-selection copies will be added here.

# Phases

## Phase 1: Domain contracts and factory infrastructure

**Description:** Define the new domain contracts required for the sheet-selection flow. This phase creates the `SpreadsheetPortFactory` interface in the Domain layer and its `GoogleSheetsAdapterFactory` implementation in the Infrastructure layer. No use case logic is written yet; this phase establishes the type-safe contracts needed for the rest of the work.

**To-do actions:**
- [x] Define `SpreadsheetPortFactory` interface in `src/domain/ports/services.ts` with a `create(accessToken: string): SpreadsheetPort` method.
- [x] Implement `GoogleSheetsAdapterFactory` in `src/infrastructure/adapters/sheets/GoogleSheetsAdapterFactory.ts` that instantiates `GoogleSheetsAdapter` with the provided token.
- [x] Add onboarding copy strings for sheet selection in `src/application/copies/onboarding.copies.ts`: `singleSheetAutoConfirm(sheetName)`, `sheetListPrompt(sheets)`, `sheetSelectedConfirmation(sheetName)`, `invalidSheetRePrompt(sheetCount)`, `sheetHeadersDescription(sheetName, headers)`.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Public contracts created/modified:**
- Domain port: `SpreadsheetPortFactory` (new).
- Text copies: `singleSheetAutoConfirm`, `sheetListPrompt`, `sheetSelectedConfirmation`, `invalidSheetRePrompt`, `sheetHeadersDescription` (new).

## Phase 2: Use case implementation and unit tests

**Description:** Implement the `HandleSheetSelection` use case with all 5 Gherkin scenarios and comprehensive unit tests. This phase includes the input/output DTOs, the use case class, and the full test suite covering happy paths, edge cases, and error paths.

**To-do actions:**
- [x] Create `HandleSheetSelectionInput` DTO in `src/application/use-cases/spreadsheet/HandleSheetSelection.ts` with fields: `userId`, `rawMessage`, `externalId`, `channel`, `statePayload`.
- [x] Create `HandleSheetSelectionOutput` DTO with fields: `nextState`, `message`, `payload`.
- [x] Create `HandleSheetSelectionDeps` interface with: `spreadsheetPortFactory`, `tokenRepository`, `transitionState`, `messagingPort`, `tokenEncryption`, `spreadsheetConfigRepository`.
- [x] Implement `HandleSheetSelection` class with `execute(input)` method.
- [x] Implement single-sheet scenario: auto-confirms, persists via `ISpreadsheetConfigRepository.create`, and transitions to `ONBOARDING_MAPPING`.
- [x] Implement multi-sheet scenario: lists sheets by name, accepts number or fuzzy name match.
- [x] Implement fuzzy name matching: normalize input (lowercase, unaccented) before comparing.
- [x] Implement "I don't know" variant: call `getHeaders` for each sheet and format a description for the user.
- [x] Implement invalid name scenario: re-prompt with the list again.
- [x] Implement error handling: token expired, API failure (wrap in `SpreadsheetError`), missing token, decryption failure.
- [x] Create `HandleSheetSelection.spec.ts` covering all 5 Gherkin scenarios plus error paths.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Public contracts created/modified:**
- Application service: `HandleSheetSelection` class with `execute` method (new).
- DTOs: `HandleSheetSelectionInput`, `HandleSheetSelectionOutput`, `HandleSheetSelectionDeps` (new).
- Test suite: `HandleSheetSelection.spec.ts` (new).

## Phase 3: Worker wiring and integration

**Description:** Wire the new use case into the message worker and the application bootstrap so that `ONBOARDING_SHEET` messages are routed to `HandleSheetSelection` instead of the placeholder. Update the worker tests and `main.ts` to include the new factory and use case.

**To-do actions:**
- [x] Update `src/interfaces/workers/message.worker.ts` to add `handleSheetSelection?: HandleSheetSelection | null` to `MessageWorkerDeps`.
- [x] Update `processMessageJob` to delegate `ONBOARDING_SHEET` to `HandleSheetSelection` when available, falling back to the placeholder otherwise.
- [x] Update `src/interfaces/workers/message.worker.spec.ts` to add tests for `ONBOARDING_SHEET` delegation (both wired and fallback cases).
- [x] Update `src/main.ts` to instantiate `GoogleSheetsAdapterFactory`, create `HandleSheetSelection`, and pass it to `createMessageWorker`.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Public contracts created/modified:**
- Test suite: `message.worker.spec.ts` (modified — new `ONBOARDING_SHEET` delegation tests).

# Next step

All phases are complete. The `HandleSheetSelection` use case is fully implemented, tested, and wired into the application. Next: update the user-story task file `T-4.03-04.md` to check off the completed acceptance criteria.
