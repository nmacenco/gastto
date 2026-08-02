# Feature: Expense Cancellation

## Purpose

Let users safely abandon an in-progress expense registration from any active expense state, without saving an expense or retaining the draft context.

## Behavior (Implemented)

- Cancellation applies only to `EXPENSE_RECEIVING`, `EXPENSE_CLARIFYING`, `EXPENSE_REVIEW`, and `EXPENSE_CORRECTING`; onboarding is unaffected.
- Supported text inputs are normalized case-insensitively. Spanish commands are `no`, `cancelar`, `cancela`, `no registres`, `para`, `stop`, and `salir`; English aliases `cancel`, `cancel it`, `do not register`, and `exit` are also accepted.
- A recognized cancellation moves the FSM to `IDLE`, clears `statePayload`, removes its expiration, and only then sends `Registro cancelado. No se guardó nada.`
- When no expense flow is active, the system leaves the state unchanged and sends `No hay ningún registro pendiente para cancelar.`
- Text commands are queued even from `IDLE`, bypassing generic non-financial guidance only for recognized cancellation commands.
- Telegram's **Cancelar** callback and review text replies use the same application cancellation use case; the use case communicates through `MessagingOutputPort`, with no Telegram-specific business logic.
- A later expense starts with fresh state and cannot reuse the canceled payload.

## API / Interface

No HTTP route or queue contract is added. `CancelExpenseRegistrationUseCase` accepts the user and chat identifiers, current FSM state, and source (`text` or `callback`), then returns `cancelled` or `no_active_expense`.

## Data Model

The feature updates the existing `conversation_states` row only. It does not create or delete `expense_records`; confirmed expenses remain unchanged.

## Tests

- [x] Unit tests verify cleanup-before-response ordering, all active expense states, and the no-active-flow response.
- [x] Worker tests verify global text commands, callback cancellation, prevention of NLP/correction processing, and immediate subsequent expense handling.
- [x] PostgreSQL integration tests persist cancellation cleanup and prove a fresh subsequent expense payload does not reuse the canceled one.

## Related User Stories

- [`E1-US-09 — Cancellation of the registration without consequences`](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-09-cancel-registration-without-consequences/E1-US-09%20%E2%80%94%20Cancellation%20of%20the%20registration%20without%20consequences.md)

## Notes

Cancellation is intentionally limited to active expense registration. It never cancels onboarding or removes already confirmed expense records.
