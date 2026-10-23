# ADR-017: Require Confirmation for Delayed Expense Undo

**Date**: 2026-08-03
**Status**: Accepted

## Context

Undoing the latest saved expense removes a row from the user's spreadsheet. The command is safe immediately after the save confirmation, but a subsequent message makes accidental deletion more likely and requires an explicit user decision.

## Decision

Persist one-message immediate eligibility in the `IDLE` state payload. A recognized undo command consumes that eligibility and may delete the current latest non-deleted expense directly.

When eligibility is absent, transition to `EXPENSE_UNDO_CONFIRMING` with the offered expense ID in `state_payload` and a short `expires_at`. Only an affirmative confirmation may invoke the undo use case; cancellation, expiration, malformed state, and ambiguous messages do not delete a spreadsheet row. Confirmation verifies that the offered record is still the latest non-deleted record.

The external spreadsheet deletion occurs before the local transaction that soft-deletes the expense and creates the `EXPENSE_DELETED` audit event. This avoids declaring a local deletion when the provider did not remove the row.

## Consequences

- A delayed command cannot silently delete an expense.
- The persisted FSM state survives worker restarts and timeout handling returns the user to `IDLE`.
- The `conversation_states` check constraint requires migration `0006_add_undo_confirming_state.sql` before deployment.
- The feature is Google Sheets-only until another provider implements `SpreadsheetPort.deleteRow` with the same contract.

## Related ADRs

- [ADR-003](./ADR-003-fsm-postgresql.md)
- [ADR-004](./ADR-004-spreadsheet-adapter.md)
- [ADR-006](./ADR-006-write-confirmation.md)
