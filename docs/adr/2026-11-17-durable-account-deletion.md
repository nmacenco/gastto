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

Expense append and undo now hold a PostgreSQL key-share row lock throughout the external Sheets request and local finalization. The confirmation's `FOR UPDATE` lock waits for those calls to settle; an effect arriving after the barrier is rejected before reaching Sheets. This keeps a database transaction open during the remote call and requires enough pool capacity for its local repository work. A lost database connection during an unresolved external call is not yet independently fenced; active-job draining and failure-path verification remain release gates.

## Consequences

- Pending operations temporarily hold user UUIDs and messaging identities for recovery and cleanup, then remove them. Opaque `/start` replay markers expire after 48 hours; their purpose and duration must appear in privacy documentation.
- A remote revocation failure is reported as unconfirmed. No credential is retained for indefinite retry.
- A PostgreSQL migration must precede workers that query the barrier. A rollback cannot restore erased account data.
- Hosted logs, backups, and exports require separate verified retention and restore controls before production activation.

## Phase 3 restoration decision pending

A completed operation removes its temporary row. Restoring a PostgreSQL backup from before that completion can therefore resurrect a deleted identity and encrypted credentials without leaving a barrier to detect them. The existing design cannot safely reconcile such a restore.

The proposed release protocol is to restore into quarantine with no ingress or workers, then compare the restored user UUIDs to a bounded, keyed erasure record kept outside the restored database. The record would expire after the longest verified backup recovery window; it would not be a permanent identifying tombstone. A separate store, key custody, retention period, and a tested reconciliation tool have not been selected. Until they exist, this ADR remains proposed and production deletion must stay disabled. See the [recovery runbook](../operations/account-deletion-recovery.md).

## References

- [Data model](../architecture/data-model.md)
- [Account deletion feature](../features/account-deletion.md)
- [Google OAuth revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)
