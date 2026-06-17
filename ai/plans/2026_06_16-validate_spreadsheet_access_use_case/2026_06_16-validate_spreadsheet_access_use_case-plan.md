# Plan: Implement Validate Spreadsheet Access use case (HU-4.04 T-4.04-04/05/06)

## Goal

Implement the Application-layer `ValidateSpreadsheetAccess` use case, wire it into the conversational FSM after sheet selection, and complete the HU-4.04 acceptance scenarios including automatic retry, user-facing error messages, and feature documentation.

## Context

- Domain port and value objects are already implemented in T-4.04-01:
  - `src/domain/ports/spreadsheetAccess.ts`
  - `src/domain/value-objects/SpreadsheetAccessResult.ts`
  - `src/domain/entities/SpreadsheetPreview.ts`
- Infrastructure adapters are already implemented in T-4.04-02/03:
  - `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts`
  - `src/infrastructure/adapters/sheets/ExcelOnlineAdapter.ts`
- Sheet selection currently transitions directly to `ONBOARDING_MAPPING` from `src/application/use-cases/spreadsheet/HandleSheetSelection.ts`.
- The conversation entry point is `src/interfaces/workers/message.worker.ts`; composition root is `src/main.ts`.
- Feature doc: `docs/features/validate-spreadsheet-access.md`.
- Data model doc: `docs/architecture/data-model.md`.

## Phases

### Phase 1 — Skeleton validation flow

**Description:** Add the `ONBOARDING_VALIDATING_ACCESS` FSM state, redirect `HandleSheetSelection` into it, create the adapter factory and a skeleton use case that only handles the transparent success path, and wire it end-to-end.

- [x] Add `ONBOARDING_VALIDATING_ACCESS` to `FSM_STATES` and `FSM_TRANSITIONS` in `src/domain/entities/ConversationState.ts`.
- [x] Update `src/infrastructure/db/schema/index.ts` `chk_conversation_state` to include `ONBOARDING_VALIDATING_ACCESS`.
- [x] Run `pnpm db:generate` to create the migration.
- [x] Modify `src/application/use-cases/spreadsheet/HandleSheetSelection.ts` so `confirmSheet` transitions to `ONBOARDING_VALIDATING_ACCESS` instead of `ONBOARDING_MAPPING` (keep persisting `spreadsheet_configs` with placeholder `accessVerifiedAt`).
- [x] Define `ValidateSpreadsheetAccessPortFactory` interface in `src/domain/ports/spreadsheetAccess.ts`.
- [x] Create `src/infrastructure/adapters/sheets/SpreadsheetAccessAdapterFactory.ts` implementing the factory for `google` (and `microsoft` when wired).
- [x] Create skeleton `src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts` that resolves provider/token, calls the port, and on `success` updates `accessVerifiedAt` and transitions to `ONBOARDING_MAPPING`.
- [x] Route `ONBOARDING_VALIDATING_ACCESS` in `src/interfaces/workers/message.worker.ts` to the new use case.
- [x] Wire the factory and use case in `src/main.ts`.
- [x] Update `src/application/use-cases/spreadsheet/HandleSheetSelection.spec.ts` expectations for the new transition target.
- [x] Add `ONBOARDING_VALIDATING_ACCESS` tests to `src/interfaces/workers/message.worker.spec.ts`.
- [x] Create skeleton `src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.spec.ts` covering the success path.
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix issues.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2 — Full access-validation business logic

**Description:** Implement the four HU-4.04 result branches, automatic retry, user-facing copies, and empty-sheet confirmation handling.

- [ ] Implement `read-only` branch in `ValidateSpreadsheetAccess`: send a message explaining missing write permission and how to fix it in Google Drive / OneDrive; stay in `ONBOARDING_VALIDATING_ACCESS`.
- [ ] Implement `empty-sheet` branch: send a message asking the user to confirm the sheet or choose another; transition to `ONBOARDING_SHEET` with `step: 'empty-sheet-confirm'` and preserved `sheetList`.
- [ ] Implement `access-error` branch: retry once automatically when `retryable: true`; on persistent error send a reconnect-account message and transition to `ONBOARDING_START`.
- [ ] Add message copies to `src/application/copies/onboarding.copies.ts` for read-only, empty-sheet, and reconnect-account scenarios.
- [ ] Extend `HandleSheetSelection` to handle `step === 'empty-sheet-confirm'`: confirm words send an out-of-MVP message; otherwise treat the reply as a sheet selection attempt using `sheetList`.
- [ ] Add unit tests in `ValidateSpreadsheetAccess.spec.ts` for success, read-only, empty-sheet, access-error with automatic retry, persistent access-error, missing token, expired/revoked token, and decryption failure.
- [ ] Update `message.worker.spec.ts` to cover routing and the new branches.
- [ ] Run `pnpm lint` and `pnpm typecheck`. Fix issues.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3 — Documentation, integration, and ship check

**Description:** Update canonical docs, add integration-level coverage, run the full ship check, and sync the backlog task files.

- [ ] Update `docs/features/validate-spreadsheet-access.md`: mark user-facing messages, retry logic, and empty-sheet handling as implemented; remove TODOs; update API/Interface and Tests sections.
- [ ] Update `docs/architecture/data-model.md` to list `ONBOARDING_VALIDATING_ACCESS` in the FSM state description.
- [ ] Add or extend integration tests for the full handler-to-use-case flow, including a simulated expired-token test.
- [ ] Run `pnpm lint && pnpm typecheck && pnpm test`. Fix issues.
- [ ] Update `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.04-read-and-validate-spreadsheet-access/tasks/T-4.04-04.md`, `T-4.04-05.md`, and `T-4.04-06.md` by checking off satisfied acceptance criteria.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Start Phase 2 by implementing the full access-validation business logic (read-only, empty-sheet, access-error with retry).
