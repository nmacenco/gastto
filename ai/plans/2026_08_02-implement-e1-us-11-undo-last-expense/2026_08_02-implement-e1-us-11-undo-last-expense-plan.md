# Implement E1-US-11 Undo Last Expense

## Goal

Deliver a safe Google Sheets-only undo flow for the latest saved expense. The next inbound message after saving may undo immediately; any later undo requires explicit confirmation.

## Context

- `src/application/use-cases/expense/UndoLastExpense.ts`: Application undo orchestration.
- `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts`: Google Sheets row deletion.
- `src/interfaces/workers/message.worker.ts`: Chat command routing.
- `docs/adr/adr.md`, `docs/architecture/data-model.md`, and the relevant feature documentation govern the FSM, persistence, and provider boundaries.

## Phase 1: Immediate undo vertical slice

- [x] Rework the undo use case to use `SpreadsheetPortFactory`, OAuth-token lookup, and token decryption.
- [x] Implement Google Sheets row deletion through `batchUpdate` after resolving the numeric sheet ID.
- [x] Delete externally before atomically soft-deleting and auditing locally.
- [x] Route normalized `deshacer`, `undo`, and `borrar el último` commands from `IDLE`.
- [x] Persist the saved expense ID as immediate-undo eligibility in the `IDLE` payload.
- [x] Add application, adapter, and worker tests for the vertical slice.
- [x] Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`.

## Phase 2: Confirmation-safe delayed undo

- [x] Add `EXPENSE_UNDO_CONFIRMING`, its short expiry, payload, transitions, schema constraint, and generated migration.
- [x] Clear immediate eligibility for every non-undo inbound message.
- [x] Route confirmation, cancellation, and timeout safely to `IDLE`.
- [x] Add delayed-flow and safety coverage.

## Phase 3: Verification and documentation

- [x] Add PostgreSQL integration coverage for latest-record lookup and failure preservation.
- [x] Update the feature, data-model, and FSM ADR documentation and their indexes.
- [x] Check completed E1-US-11 task acceptance criteria and run the ship checks.

## Next step

Apply migration `0006_add_undo_confirming_state.sql` to each target database before deployment.
