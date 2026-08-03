# Feature: Undo Last Expense

## Purpose

Allow a user to remove only their most recently saved expense from a Google Sheet. An undo immediately following the save is performed directly; after any other inbound message, the user must explicitly confirm the proposed deletion.

## Behavior (Implemented)

- In `IDLE`, normalized `deshacer`, `undo`, and `borrar el último` request an undo.
- A successful save stores the saved expense ID as one-message immediate-undo eligibility in the `IDLE` payload. Any other inbound message clears that eligibility before normal routing.
- Immediate undo retrieves the latest non-deleted expense, deletes its referenced Google Sheets row, then atomically soft-deletes the local record and writes an `EXPENSE_DELETED` audit event.
- A later undo never deletes immediately. It enters `EXPENSE_UNDO_CONFIRMING` with the offered expense ID and a short expiry, and asks the user to confirm the latest record.
- Confirmation deletes only the offered record if it remains the current latest non-deleted expense. Cancellation and expiry return safely to `IDLE` without a deletion.
- If no undoable record exists, or deletion cannot be completed, the user receives a safe response without provider details. A failed external deletion leaves the local expense active and records no successful deletion audit event.
- The scope excludes repeated or batch undo. Only the latest non-deleted expense can be selected.

## API / Interface

No public HTTP route is added. `message.worker` delegates undo decisions to `UndoLastExpenseUseCase`; the worker owns message normalization and presentation only. `UndoLastExpenseUseCase` receives the internal user ID, action (`request` or `confirm`), immediate eligibility, and the pending expense ID for a confirmation.

The spreadsheet integration remains behind `SpreadsheetPortFactory` and `SpreadsheetPort.deleteRow`; no provider SDK types enter the Application layer.

## Data Model

- `conversation_states.current_state` permits `EXPENSE_UNDO_CONFIRMING` after migration `0006_add_undo_confirming_state.sql`.
- The confirming-state payload contains `pendingExpenseId`; its `expires_at` enforces the short confirmation window.
- `expense_records` continues to use the existing soft-delete fields. Latest lookup filters `is_deleted = false` and orders by `saved_at DESC`.
- Successful local completion uses one transaction for the soft delete and `operation_logs` entry with `operation = 'EXPENSE_DELETED'`.

Apply migration `0006_add_undo_confirming_state.sql` with `pnpm db:migrate` to every target database before deploying this feature.

## Tests

- Application tests cover immediate deletion ordering, confirmation safety, not-found behavior, and external deletion failure preservation.
- Google Sheets adapter tests cover resolving the numeric sheet ID and deleting the exact row through `batchUpdate`.
- Worker tests cover recognized commands, delayed confirmation, cancellation, timeout, and clearing immediate eligibility.
- PostgreSQL integration tests cover latest non-deleted lookup and transactional local undo persistence.

## Related User Stories

- `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-11-undo-the-last-registered-expense/E1-US-11 — Undo the last registered expense.md`
