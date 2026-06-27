# ADR-003: Persist Conversational FSM in PostgreSQL

**Date**: 2025-04
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

Gastto's conversational flows are multi-turn and can last minutes or hours (a user may start a registration, interrupt it, and resume later). The system must know at all times where each user is in the flow to respond coherently.

State cannot reside in process memory because a restart would wipe all active contexts. Durable persistence and the ability to audit failed flows are required.

## Considered Options

1. **State only in Redis (memory)**
   - Pros: Very fast reads/writes, simple key-value model.
   - Cons: Redis can restart or keys can expire. Onboarding flows can last hours. Durable persistence is required.

2. **State in process memory (variables)**
   - Pros: Zero latency, no external dependency.
   - Cons: A Node.js process restart wipes all active states. Incompatible with horizontal scaling.

3. **FSM persisted in PostgreSQL**
   - Pros: Durable, auditable, supports long-running flows, integrates with existing data layer.
   - Cons: Each state transition writes to the database, adding minimal but constant latency.

## Decision

Model each user's conversation state as a **Finite State Machine (FSM) persisted in PostgreSQL**. Redis is used only as cache; the message queue is managed by BullMQ over Redis (ADR-005), but never as the primary state store.

The defined MVP states are:

| State                   | Description                             | Outgoing transitions                                 |
| ----------------------- | --------------------------------------- | ---------------------------------------------------- |
| `IDLE`                  | No active flow                          | → `ONBOARDING_START` \| `EXPENSE_RECEIVING`          |
| `ONBOARDING_START`      | First contact, no linked spreadsheet    | → `ONBOARDING_START` (set `promptShown`) \| `ONBOARDING_DRIVE` |
| `ONBOARDING_DRIVE`      | Waiting for OAuth connection            | → `ONBOARDING_FILE`                                  |
| `ONBOARDING_FILE`       | Waiting for file selection              | → `ONBOARDING_FILE` (store `fileList` / `step`) \| `ONBOARDING_SHEET` |
| `ONBOARDING_SHEET`      | Waiting for sheet selection             | → `ONBOARDING_SHEET` (store `sheetList` / `step`) \| `ONBOARDING_MAPPING` |
| `ONBOARDING_MAPPING`    | Waiting for column mapping confirmation | → `ONBOARDING_CATEGORIES`                            |
| `ONBOARDING_CATEGORIES` | Waiting for category confirmation       | → `IDLE`                                             |
| `EXPENSE_RECEIVING`     | Message received, processing NLP        | → `EXPENSE_CLARIFYING` \| `EXPENSE_REVIEW`           |
| `EXPENSE_CLARIFYING`    | Waiting for user clarification          | → `EXPENSE_REVIEW` \| `IDLE`                         |
| `EXPENSE_REVIEW`        | Summary sent, waiting for confirmation  | → `EXPENSE_SAVING` \| `EXPENSE_CORRECTING` \| `IDLE` |
| `EXPENSE_CORRECTING`    | Applying user correction                | → `EXPENSE_REVIEW`                                   |
| `EXPENSE_SAVING`        | Writing to spreadsheet                  | → `IDLE` \| `EXPENSE_SAVING_RETRY`                   |
| `EXPENSE_SAVING_RETRY`  | Retrying failed save (TTL: 10 min)      | → `IDLE`                                             |

## Rationale

- Resilience against restarts: state survives process crashes.
- Enables auditing and debugging of failed flows by querying the database directly.
- Native support for long-duration flows (onboarding can take hours).
- The FSM makes all possible states explicit, reducing unexpected behaviors.

## Consequences

### Positive

- Resilience against restarts.
- Enables auditing and debugging of failed flows.
- Native support for long-duration flows.
- Explicit states reduce unexpected behaviors.

### Negative

- Each state transition implies a database write, adding minimal but constant latency.
- Keeping the state map synchronized with user stories requires discipline: an unconsidered state can cause unexpected production behavior.

## References

- [`docs/architecture/fsm-states.md`](../architecture/fsm-states.md)
- [`docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/`](../user-stories/01-mvp/00-Infraestructura%20conversacional%20MVP/)
