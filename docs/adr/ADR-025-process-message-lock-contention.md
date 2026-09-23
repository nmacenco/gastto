# ADR-025: Extend process-message lock-contention retries

**Date**: 2026-09-23  
**Status**: Accepted  
**Deciders**: Gastto team

## Context

`process-message` serializes jobs per user with a Redis lock. Spreadsheet onboarding performs eager access validation and column inference while that lock is held; the inference path can include one or two LLM calls. A second user message can therefore encounter `UserAlreadyProcessingError` for longer than the previous five-attempt retry budget. BullMQ also emits `failed` for each failed attempt, so the old worker log incorrectly reported retryable contention as a permanent failure.

## Decision

Keep retries restricted to `UserAlreadyProcessingError`, increase the queue budget to 12 attempts, and log whether the failed attempt will be retried or is permanent. Non-lock errors are permanent even when attempts remain; a job already marked finished is also permanent.

## Rationale

- Per-user mutual exclusion and side-effect safety remain unchanged. The mutex does not guarantee FIFO ordering between delayed messages and newer arrivals.
- The eleven delays total 42.5 seconds (previously 7.5 seconds). This gives spreadsheet inference more time to release the lock, without guaranteeing completion within that window.
- Non-lock errors still do not replay side-effectful handlers.
- Operational logs accurately distinguish transient contention from a dead-lettered job.

## Consequences

### Positive

- Messages arriving during eager spreadsheet inference can wait longer before exhausting their attempts.
- Alerts and dashboards no longer treat every retry as a permanent job failure.

### Negative

- A genuinely stuck lock can keep a job retrying for longer before it is exhausted.
- The user may experience delayed processing while the previous message completes.
- Inference lasting beyond the retry window can still exhaust a waiting message. The renewable 180-second lock TTL is not an execution deadline; this change is a mitigation, not a complete solution for unbounded provider latency.
- Existing jobs retain their saved attempt options; new queue defaults do not repair already failed jobs.

## References

- [ADR-015](./ADR-015-upsert-spreadsheet-config-on-reonboarding.md)
- [Incoming message routing](../features/incoming-message-routing.md)
