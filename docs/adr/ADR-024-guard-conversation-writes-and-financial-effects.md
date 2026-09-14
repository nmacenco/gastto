# ADR-024: Guard Conversation Writes, Presented Actions, and Financial Effects

**Date**: 2026-09-12
**Status**: Accepted
**Deciders**: Engineering

## Context

User-level Redis serialization does not prove that delayed work still owns the state it interpreted. Lease expiry, timeout scans, OAuth callbacks, and process restarts can overlap. Spreadsheet append/delete operations also cannot participate in a PostgreSQL transaction, so replay after an uncertain remote result can duplicate a financial effect.

## Considered Options

1. Rely only on the Redis per-user lease. This is simple but cannot reject work produced before lease loss.
2. Hold a database transaction across remote calls. This creates long-lived locks and still cannot atomically commit with a provider.
3. Use state revisions plus persistent execution claims. This adds explicit recovery work but rejects stale writers and prevents automatic replay.

## Decision

Use option 3. Every `conversation_states` mutation compares the observed `revision`, state, and required database-time expiry and increments the revision. Timed financial authorization requires a non-null future expiry. Redis leases are token-safe and renewed every 30 seconds, while an async execution context propagates the latest committed snapshot and invalidates pending work after ownership loss.

Before spreadsheet append, retry, or delete, persist an application-owned JSONB `executionClaim` containing a unique claim ID, operation kind, immutable target, source message when available, and status. Writers without the matching claim cannot replace claimed state. Only that claim may finalize the local outcome. An unresolved or unknown remote outcome remains claimed and requires manual resolution; lease expiry and process restart never release or replay it automatically.

Delayed undo and explicit save retry additionally persist a strict opaque operation ID/revision and nullable successful-presentation timestamp before accepting authorization. Legacy or uncertain delivery is re-presented and the triggering message is not consumed. Authorization requires a non-null future expiry and a channel timestamp later than presentation, then is atomically consumed into the execution claim. Undo reloads the latest non-deleted record under the claim before external deletion.

Spreadsheet adapters distinguish failures known to precede a mutation from failures observed after an append/delete request was sent. Transport failures, provider 5xx responses after dispatch, and local finalization failures after remote success preserve the claim as `outcome_unknown`; only known no-effect failures may enter the explicit retry or clear the claim.

Queue advancement removes the exact queue item that produced the committed successor state. Timeout and OAuth messages are emitted only after their guarded state change commits. OAuth callbacks validate the persisted nonce and revision before exchange and again before token persistence.

## Rationale

- PostgreSQL compare-and-swap is the durable authority for stale-context rejection.
- Redis remains an admission and load-control mechanism, not financial authorization.
- Persistent claims make ambiguous external outcomes visible without claiming exactly-once delivery.
- No database transaction is held open across network work.

## Consequences

### Positive

- Delayed workers cannot overwrite a newer same-state revision.
- Duplicate delivery cannot automatically repeat an unresolved spreadsheet effect.
- Old Redis tokens cannot renew or release a successor lease.

### Negative

- Operators need a manual unresolved-claim investigation procedure.
- All state writers must be deployed together with migration `0009_wooden_polaris.sql`.
- Rolling back writers while claims exist is unsafe.

## Deployment and rollback

Apply migration `0009` before deploying the coordinated writer release. Drain or pause old workers so no unguarded writer remains active. After deployment, re-present queued legacy undo/retry jobs and inspect unresolved claims before resuming financial processing. Roll back application code only after pausing workers and confirming no active claims; a router flag does not roll back this safety layer. Keep the additive `revision` column and revert the release with a merge-commit revert. Never edit or delete the applied migration.

## References

- [ADR-003](./ADR-003-fsm-postgresql.md)
- [ADR-011](./ADR-011-two-stage-pipeline.md)
- [ADR-017](./ADR-017-undo-confirmation-fsm.md)
- [ADR-018](./ADR-018-user-initiated-save-retry.md)
