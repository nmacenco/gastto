# Feature: Undo Last Expense

## Purpose

Allow a user to remove only their most recently saved expense from a Google Sheet. An undo immediately following the save is performed directly; after any other inbound message, the user must explicitly confirm the proposed deletion.

## Behavior (Implemented)

- In `IDLE`, normalized `deshacer`, `undo`, and `borrar el último` request an undo.
- A successful save stores the saved expense ID as one-message immediate-undo eligibility in the `IDLE` payload. Any other inbound message clears that eligibility before normal routing.
- Immediate undo retrieves the latest non-deleted expense, deletes its referenced Google Sheets row, then atomically soft-deletes the local record and writes an `EXPENSE_DELETED` audit event.
- A later undo never deletes immediately. It enters `EXPENSE_UNDO_CONFIRMING` with the offered expense ID, an opaque action operation ID/revision, a nullable successful-presentation timestamp, and a five-minute expiry.
- In enabled semantic mode, an unambiguous inferred undo is allowed only from `IDLE` and always follows the delayed-confirmation path. Application-created `semantic_request` provenance cannot carry an immediate expense ID, so valid one-message immediate eligibility remains untouched as authorization and no row is deleted in the inferred request turn.
- The action binding is persisted before the prompt is sent and `presentedAt` is committed only after successful delivery. Legacy or failed-delivery prompts are re-presented with a new revision; the message that triggered re-presentation never deletes.
- Text confirmation is accepted only when its channel timestamp is strictly later than the persisted `presentedAt`. Missing, malformed, expired, superseded, or already claimed context produces no provider deletion.
- Confirmation deletes only the offered record if it remains the current latest non-deleted expense. Cancellation and expiry return safely to `IDLE` without a deletion.
- If no undoable record exists, or deletion cannot be completed, the user receives a safe response without provider details. A failed external deletion leaves the local expense active and records no successful deletion audit event.
- The scope excludes repeated or batch undo. Only the latest non-deleted expense can be selected.
- Before external deletion, undo atomically consumes the exact action binding into a unique execution claim bound to the latest expense ID, sheet, and row. It then reloads the latest non-deleted record under that claim and rejects a replacement before calling the provider. The delete begins only while that claim and the user lease remain owned. Only the same claim can finalize the local soft delete/audit; an ambiguous provider failure remains `outcome_unknown` for manual resolution and blocks automatic replay.

## API / Interface

No public HTTP route is added. `message.worker` delegates undo decisions to `UndoLastExpenseUseCase`. `PresentUndoConfirmation` owns the shared binding-before-delivery and successful-presentation sequence used by deterministic delayed and semantic requests. `UndoLastExpenseUseCase` receives the internal user ID, action (`request` or `confirm`), explicit-versus-semantic request provenance, immediate eligibility only for explicit commands, and the pending expense ID for a confirmation.

The spreadsheet integration remains behind `SpreadsheetPortFactory` and `SpreadsheetPort.deleteRow`; no provider SDK types enter the Application layer.

## Data Model

- `EXPENSE_UNDO_CONFIRMING` permits a guarded self-transition for presentation completion/re-presentation and `IDLE` after cancellation, expiry, or claimed completion.
- The confirming-state payload contains `pendingExpenseId`; its `expires_at` enforces the short confirmation window.
- `expense_records` continues to use the existing soft-delete fields. Latest lookup filters `is_deleted = false` and orders by `saved_at DESC`.
- Successful local completion uses one transaction for the soft delete and `operation_logs` entry with `operation = 'EXPENSE_DELETED'`.

Apply migration `0006_add_undo_confirming_state.sql` with `pnpm db:migrate` to every target database before deploying this feature.

## Tests

- Application tests cover immediate deletion ordering, confirmation safety, not-found behavior, and external deletion failure preservation.
- Google Sheets adapter tests cover resolving the numeric sheet ID and deleting the exact row through `batchUpdate`.
- Worker and application tests cover recognized commands, one-message eligibility consumption, bound/re-presented delayed confirmation, strict received-time ordering, cancellation, expiry-before-sweep, replacement of the latest target, concurrent confirmation, and zero unauthorized deletion.
- `tests/integration/financial-action-context.integration.spec.ts` uses PostgreSQL and Redis to cover expiry predicates, single claim consumption, unresolved-claim restart behavior, competing timeout/OAuth-style writers, and stale deferred proposals.
- PostgreSQL integration tests cover latest non-deleted lookup and transactional local undo persistence.
- `semantic-router-control-flows.integration.spec.ts` passes PostgreSQL/Redis inferred-offer, no-premature-deletion, exact immediate undo, and concurrent later-confirmation coverage alongside the complete recovery control slice.

## Related User Stories

- `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-11-undo-the-last-registered-expense/E1-US-11 — Undo the last registered expense.md`
