# ADR-006: Implement Write-with-Confirmation and Retry for Save Reliability

**Date**: 2025-04
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

Trust is the product's core value. Failures in persisting to the spreadsheet (revoked permissions, network errors, structure changes) must be clearly communicated to the user, offering resolution paths. Silent failure is explicitly prohibited (E1-US-12). Additionally, the user must be able to undo the last registration (E1-US-11), which requires knowing the exact row reference after each write.

## Considered Options

1. **Fire-and-forget (no confirmation)**
   - Pros: Fastest response, minimal code.
   - Cons: The system would not know if the save succeeded or which row it landed on, making E1-US-11 impossible and violating E1-US-12.

2. **Confirmation without row reference**
   - Pros: User knows the save happened.
   - Cons: Partially satisfies E1-US-10 but prevents the undo operation (E1-US-11).

3. **Write-with-Confirmation with persisted retry and manual fallback**
   - Pros: Deterministic undo, zero data loss, clear error classification.
   - Cons: More development effort in exception handling and error message design.

## Decision

Implement the **Write-with-Confirmation** pattern with **persisted retry** and **manual fallback**.

### Successful save flow

1. The Spreadsheet Service executes `appendRow()` and waits for the API response (Google/Microsoft).
2. The response includes the resulting row index.
3. Only if the response is successful, the system internally persists the reference `{ userId, sheetName, rowIndex }` as the "last record" (required for E1-US-11 — undo).
4. The confirmation message is built with that reference and sent to the user: `"✅ Guardado en Gastos, fila 47"`.

### Failed save flow

- Expense data is kept in the `EXPENSE_SAVING_RETRY` state with a 10-minute TTL.
- The system distinguishes three error types and responds differently to each:

| Error Type        | Cause                                               | System Action                            |
| ----------------- | --------------------------------------------------- | ---------------------------------------- |
| `NETWORK_ERROR`   | Timeout or network error to API                     | Automatic retry with exponential backoff |
| `AUTH_ERROR`      | Expired token or revoked permissions (HTTP 401/403) | Notify user with re-authentication link  |
| `STRUCTURE_ERROR` | Column or sheet not found (outdated mapping)        | Notify user with re-mapping instructions |

- If the save fails definitively, the bot sends the formatted expense to the user so they can copy and paste it manually, guaranteeing the information is never lost.

## Rationale

- Zero data loss: the `EXPENSE_SAVING_RETRY` state with TTL guarantees data survives temporary failures.
- Reinforces system reliability perception: the user always receives feedback, never silence.
- The persisted last-record reference makes E1-US-11 (undo) a deterministic index-based deletion without ambiguity.
- Avoids UX dead-ends: every error type offers a resolution path.

## Consequences

### Positive

- Zero data loss with `EXPENSE_SAVING_RETRY` state and TTL.
- Reinforces reliability perception with guaranteed user feedback.
- Deterministic undo via persisted row reference.
- Every error type offers a resolution path.

### Negative

- Requires more development effort in exception handling logic and error message design.
- Error classification must stay synchronized with actual Google and Microsoft API response codes, which may change.

## References

- [`docs/user-stories/01-mvp/02-Registro de Gastos/`](../user-stories/01-mvp/02-Registro%20de%20Gastos/)
