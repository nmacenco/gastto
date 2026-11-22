# ADR-034: Use a durable barrier for account deletion

**Date**: 2026-11-17
**Status**: Proposed
**Deciders**: Gastto maintainers

## Context

Gastto stores account data in PostgreSQL, Redis, and BullMQ. OAuth revocation is a remote request and cannot share a transaction with local deletion. Existing messages and callbacks can race with cleanup. The expense-to-configuration foreign key uses NO ACTION, so account deletion must explicitly delete expenses first.

## Considered Options

1. Delete the user row and rely on database cascades. This leaves Redis jobs and keys and can fail on the expense foreign key.
2. Run one synchronous deletion inside the Telegram message worker. This cannot safely remove its own active job and has no durable retry after an outage.
3. Persist a deletion barrier and run a separate recoverable worker. This adds temporary operation records and cross-system cleanup logic.

## Decision

Use option 3 in development. The operation row is the durable barrier and is removed after cleanup and bounded final notification handling. A separate worker handles revocation, account data, and queue cleanup, with periodic recovery scans. Production activation remains gated on complete integration and operational verification.

## Rationale

The barrier prevents new ingress, worker effects and OAuth use while a deletion is incomplete. Identity-cache fills and known-identity queue admission hold a shared lock on the user row until the Redis write completes; starting deletion takes an exclusive lock on that row before recording the barrier. Unknown non-`/start` deliveries are dropped. The dedicated worker can remove the confirming message job after it finishes. Local tokens are deleted regardless of remote revocation outcome. Account rows are deleted transactionally after expense records, preserving Sheets content.

Known external account effects register a durable count on the `users` row in a short transaction before the remote call and release it after local work settles. Registration and confirmation both lock the user row, so a new effect either registers before the barrier or is rejected. Confirmation may open the barrier while registered work is active; the deletion worker checks the count before revocation and account erasure, and the erasure transaction checks again. A lost database connection cannot erase the committed count. This avoids holding a transaction open during a remote call, but a crash or release failure can leave an orphaned count. It must not expire automatically because a stale external effect could still complete later. Operator reconciliation requires quiescing workers and verifying the external outcome before clearing the count; until that procedure is exercised, production activation remains blocked.

Google OAuth callbacks take the per-user Redis lock before the same durable fence. This lock order avoids an inversion with message-worker confirmation, and the registration spans code exchange plus credential persistence. A callback that reaches the fence after barrier creation does not exchange its code.

## Consequences

- Pending operations temporarily hold user UUIDs and messaging identities for recovery and cleanup, then remove them. A separate PostgreSQL `/start` receipt stores only a keyed HMAC digest and expiry for 48 hours, independently of the user row. Hourly pruning removes expired receipts. The receipt is retained after a failed welcome because identity creation may already have committed; a new `/start` can use a new message ID. Its purpose and duration must appear in privacy documentation.
- A remote revocation failure is reported as unconfirmed. No credential is retained for indefinite retry.
- A PostgreSQL migration must precede workers that query the barrier. A rollback cannot restore erased account data.
- Hosted logs, backups, and exports require separate verified retention and restore controls before production activation.

## Phase 3 restoration decision pending

A completed operation removes its temporary row. Restoring a PostgreSQL backup from before that completion can therefore resurrect a deleted identity and encrypted credentials without leaving a barrier to detect them. The existing design cannot safely reconcile such a restore.

The proposed release protocol is to restore into quarantine with no ingress or workers, then compare the restored user UUIDs to a bounded, keyed erasure record kept outside the restored database. The record would expire after the longest verified backup recovery window; it would not be a permanent identifying tombstone. A separate store, key custody, retention period, and a tested reconciliation tool have not been selected. Until they exist, this ADR remains proposed and production deletion must stay disabled. See the [recovery runbook](../operations/account-deletion-recovery.md).

On 2026-11-22 the owner confirmed that production Redis uses Aiven and has three visible backups dated 2026-11-21 and 2026-11-22. Aiven can restore a backup after a service power cycle, so a procedural ban on historical PostgreSQL restores does not protect Redis. The development implementation now records a non-identifying cleanup epoch in PostgreSQL, mirrors it in Redis after account cleanup, and records Valkey's server `run_id` in PostgreSQL. In non-production environments, startup, HTTP ingress, and BullMQ processors compare both signals and fail closed on a mismatch. This detects a stale snapshot or server replacement; it does not reconcile restored jobs and keys. The detector remains inactive in production while deletion is disabled because routine Aiven restarts could otherwise halt service without a recovery command. Operator cleanup, CLI gating, live-restore rehearsal, and a verified backup retention limit remain release blockers. The runbook records the ordering and rehearsal cases.

The read-only inventory now validates restored job payloads against worker schemas and groups decisions by queue. A queued job for a current account remains unresolved even when its owner and identity match PostgreSQL: the backup cannot prove whether its external effect happened later. Completed and failed history, pending deletion jobs, orphaned jobs, the global session timer, and invalid payloads are separate counts. These classifications are advisory and never authorize replay or reset. An effect outcome record or a reviewed incident procedure is needed before any uncertain job can be resumed or removed.

For OAuth reminders only, the current PostgreSQL conversation state can establish that a delayed reminder belongs to an obsolete flow or nonce. The inventory reports it as `obsoleteReminder` for operator review. A still-active job remains unresolved, and a reminder whose flow is current remains unresolved: neither case proves whether a message was sent after the backup. This evidence narrows the manual decision; it does not turn the restored queue into an automatically replayable source.

The local reconciliation command now implements the conservative clean case: with application processes stopped, it rejects active or uncertain work and unknown Redis key families, removes proven orphaned account state and obsolete reminders, then updates the Redis marker and Valkey run ID only after a second inventory. A worker that detects a restore pauses and delays its claimed job instead of consuming failure attempts. `ACCOUNT_DELETION_ENABLED` is an explicit production opt-in that activates the Telegram action and the restore guard together; it remains off until provider retention, live-restore rehearsal, and the unresolved-job incident procedure are verified. The operator command cannot prove that Fly has been stopped or resolve an external effect whose outcome is unknown.

## References

- [Data model](../architecture/data-model.md)
- [Account deletion feature](../features/account-deletion.md)
- [Google OAuth revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)
