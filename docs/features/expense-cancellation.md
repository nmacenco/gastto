# Feature: Expense Cancellation

## Purpose

Let users safely abandon an in-progress expense registration from any active expense state, without saving an expense or retaining the draft context.

## Behavior (Implemented)

- Cancellation applies only to `EXPENSE_RECEIVING`, `EXPENSE_CLARIFYING`, `EXPENSE_REVIEW`, and `EXPENSE_CORRECTING`; onboarding is unaffected.
- Supported text inputs are normalized case-insensitively. Spanish commands are `no`, `cancelar`, `cancela`, `no registres`, `para`, `stop`, and `salir`; English aliases `cancel`, `cancel it`, `do not register`, and `exit` are also accepted.
- A recognized cancellation moves the FSM to `IDLE`, clears `statePayload`, removes its expiration, and only then sends `Registro cancelado. No se guardó nada.`
- When no expense flow is active, the system leaves the state unchanged and sends `No hay ningún registro pendiente para cancelar.`
- Text commands are queued even from `IDLE`, bypassing generic non-financial guidance only for recognized cancellation commands.
- Telegram's **Cancelar** callback and review text replies reach the cancellation use case only after the application validates the current successfully presented review binding. An old, forged, malformed, unbound, or expired button cannot cancel a replacement draft, refresh its TTL, or cancel another FSM flow.
- A later expense starts with fresh state and cannot reuse the canceled payload.
- If pending expenses exist, cancellation clears only the active draft, delivers the cancellation copy, and then advances the oldest queued expense for review.
- In enabled semantic mode, an unambiguous natural cancellation may reach the same use case only from the four active expense states. The control dispatcher revalidates the captured state/revision, expiry, execution-claim absence, and state-specific payload before cleanup.
- Semantic review cancellation additionally requires the current review version to have been presented successfully. Stale, malformed, expired, mixed, unsupported, lease-lost, or financially claimed proposals send bounded guidance and cannot cancel or advance the queue.

## API / Interface

No HTTP route or queue contract is added. `CancelExpenseRegistrationUseCase` accepts the user and chat identifiers, current FSM state, and source (`text`, `callback`, or revision-bound `semantic`), then returns `cancelled` or `no_active_expense`.

## Data Model

The feature updates the existing `conversation_states` row only. It does not create or delete `expense_records`; confirmed expenses remain unchanged.

## Tests

- [x] Unit tests verify cleanup-before-response ordering, all active expense states, and the no-active-flow response.
- [x] Worker tests verify global text commands, callback cancellation, prevention of NLP/correction processing, and immediate subsequent expense handling.
- [x] PostgreSQL integration tests persist cancellation cleanup and prove a fresh subsequent expense payload does not reuse the canceled one.
- [x] Semantic dispatcher and worker tests cover all four active states, malformed/stale/claimed contexts, cleanup ordering, typed handoff, and zero unrelated extractor/correction/undo effects.
- [x] `semantic-router-control-flows.integration.spec.ts` passes PostgreSQL/Redis revision-bound cancellation and FIFO advancement coverage and remains green with the complete retry/reconfiguration control slice.

## Related User Stories

- [`E1-US-09 — Cancellation of the registration without consequences`](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-09-cancel-registration-without-consequences/E1-US-09%20%E2%80%94%20Cancellation%20of%20the%20registration%20without%20consequences.md)

## Notes

Cancellation is intentionally limited to active expense registration. It never cancels onboarding or removes already confirmed expense records.
