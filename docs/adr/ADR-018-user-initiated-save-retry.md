# ADR-018: Limit Unconfirmed Spreadsheet Save Retries to One User-Initiated Attempt

**Date**: 2026-08-05
**Status**: Accepted
**Supersedes**: The automatic-retry wording in [ADR-006](./ADR-006-write-confirmation.md)

## Context

An append timeout does not establish whether Google Sheets accepted the row before the response was lost. Automatically retrying such an operation can append the same expense twice. The original ADR-006 correctly requires write confirmation and durable recovery, but its automatic retry wording is unsafe for a non-idempotent append.

## Decision

Retryable network failures retain the confirmed expense in `EXPENSE_SAVING_RETRY` for ten minutes and present `reintentar`. A user may explicitly request one reattempt. The retry uses the normal write-with-confirmation path: it creates the local expense record and sends the E1-US-10 confirmation only after the provider confirms the append.

Any second failure is terminal for this recovery flow. The retry payload is cleared, an audit event is recorded, and the user receives a manual-copy fallback. Authentication and structure failures are not retried: they direct the user to fresh authorization or reconfiguration respectively.

## Consequences

- The system does not perform blind duplicate-prone writes in the background.
- A timeout still has an at-least-once duplication risk if Google accepted the first write; the user can inspect the sheet before choosing `reintentar`.
- The recovery flow is durable across process restarts, limited to one explicit reattempt, and remains confined to the persisted FSM.

## Related ADRs

- [ADR-003](./ADR-003-fsm-postgresql.md)
- [ADR-004](./ADR-004-spreadsheet-adapter.md)
- [ADR-006](./ADR-006-write-confirmation.md)
- [ADR-012](./ADR-012-user-facing-text-copies.md)
