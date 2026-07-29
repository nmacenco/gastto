# Feature: Clarification Request for Ambiguous or Missing Data

## Purpose

When a user sends an expense message that is incomplete or ambiguous, the system asks for exactly one missing piece of data per turn. The goal is to complete the registration without forcing the user to retype the entire message, while preserving conversational context across turns and gracefully handling interruptions.

## Behavior (Implemented)

- The system detects missing or ambiguous amount and currency data during expense interpretation (`RegisterExpense.interpret()`).
- It asks for exactly one clarification per message; it never bombards the user with multiple questions at once.
- The clarification priority is enforced in this order:
  1. **Amount** (`monto`) — the most blocking field.
  2. **Currency** (`moneda`) — asked only after amount is known.
  3. **Category** — low-confidence categories are shown as editable in the review summary (E1-US-06), not clarified in a separate question.
- The partial expense context is persisted as an `EXPENSE_CLARIFYING` FSM state in PostgreSQL (ADR-003) with a typed JSONB payload (`ExpenseClarificationState`).
- The `EXPENSE_CLARIFYING` state has a 30-minute timeout. If the user does not respond and the session expires, the periodic timeout worker resets the state to `IDLE`.
- When the user answers the clarification question, the worker re-interprets the original message concatenated with the user's answer (`${rawMessage} ${answer}`) so the LLM and deterministic fallback see the full context.
- If the user sends a new complete expense message instead of answering the clarification, the system:
  - Discards the previous clarification flow without saving it.
  - Sends a brief cancellation notice: `"El registro anterior fue cancelado. Procesando el nuevo gasto…"`.
  - Transitions to `IDLE` and re-processes the new message as a new expense.
- If the user answers the clarification with an invalid value (e.g., `"no sé"` / `"ni idea"`), the system reformulates the question:
  - For currency, it gathers the user's default currency and up to two recently used currencies, then presents concrete options.
  - For amount, it repeats the amount question.
  - The flow remains in `EXPENSE_CLARIFYING`; the partial context is preserved.

## User-Facing Copies

| Situation                            | Copy                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| Missing amount                       | `"¿Cuánto gastaste?"`                                              |
| Missing currency                     | `"¿En qué moneda fue ese gasto?"`                                  |
| Invalid currency answer with options | `"¿El gasto fue en <options>?"`                                    |
| Interruption by new expense          | `"El registro anterior fue cancelado. Procesando el nuevo gasto…"` |

## API / Interface

This feature is not exposed via public HTTP endpoints. It is driven internally by the `process-message` BullMQ worker.

### Use Cases (Application Layer)

| Use Case                                    | Responsibility                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `RegisterExpense.interpret()`               | Detects missing amount/currency, applies the priority order, and transitions to `EXPENSE_CLARIFYING` with the typed state payload. |
| `message.worker.ts` `handleClarification()` | Routes answers, handles interruptions, reformulates invalid answers, and re-interprets enriched messages.                          |

### Value Object (Domain Layer)

- `ExpenseClarificationState` — immutable state payload with `missingField`, `partialExtracted`, and `rawMessage`. Serializes to/from JSONB with `toPayload()` / `fromPayload()` and a type guard `isExpenseClarificationState()`.

### Helpers (Application Layer)

- `isNewExpenseDuringClarification(rawMessage, missingField)` — heuristic that distinguishes a new expense message from a clarification answer.
- `buildCurrencyOptions(defaultCurrency, recentCurrencies)` — deduplicates and caps currency options for reformulation.
- `formatCurrencyOption(currency)` — returns a human-readable label for each supported currency.
- `isIdkVariant(rawMessage)` — shared intent detection for "I don't know" answers.

## Data Model

Primary table: `conversation_states` (1:1 with `users`).

| Column          | State used                                           |
| --------------- | ---------------------------------------------------- |
| `current_state` | `EXPENSE_CLARIFYING`                                 |
| `state_payload` | Typed `ExpenseClarificationState` JSONB              |
| `expires_at`    | Absolute timeout 30 minutes after entering the state |

See `docs/architecture/data-model.md` for the full schema and `conversation_states` indexes.

## FSM Transitions

| From                         | To                   | Trigger                                                             |
| ---------------------------- | -------------------- | ------------------------------------------------------------------- |
| `EXPENSE_RECEIVING` / `IDLE` | `EXPENSE_CLARIFYING` | `RegisterExpense.interpret()` returns `needs_clarification`.        |
| `EXPENSE_CLARIFYING`         | `EXPENSE_CLARIFYING` | Answer is invalid; reformulate the question.                        |
| `EXPENSE_CLARIFYING`         | `EXPENSE_CLARIFYING` | Answer resolves one missing field but another is still missing.     |
| `EXPENSE_CLARIFYING`         | `EXPENSE_REVIEW`     | Clarification completes the expense; show summary for confirmation. |
| `EXPENSE_CLARIFYING`         | `IDLE`               | New expense message interrupts the flow; re-process as new expense. |
| `EXPENSE_CLARIFYING`         | `IDLE`               | Session expires before the user answers.                            |

## Tests

- [x] `src/domain/value-objects/expense-clarification-state.spec.ts` — construction, immutability, serialization, deserialization, and type guard.
- [x] `src/application/utils/clarification.spec.ts` — interruption heuristic, currency option builder, and currency formatting.
- [x] `src/application/utils/intents.spec.ts` — "no sé" / "ni idea" variant detection.
- [x] `src/application/copies/expense.copies.spec.ts` — interruption notice and reformulation copy.
- [x] `src/application/use-cases/expense/RegisterExpense.spec.ts` — priority order, sequential amount → currency flow, and 30-minute TTL.
- [x] `src/interfaces/workers/message.worker.spec.ts` — all six Gherkin scenarios from E1-US-05:
  1. Single missing currency.
  2. Single missing amount.
  3. Ambiguous category shown in review summary.
  4. Several missing fields: amount first, then currency.
  5. New expense interrupts previous clarification.
  6. Invalid answer reformulated with concrete currency options.

## Related User Stories

- `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-05-clarification-request-for-ambiguous-or-missing-data/E1-US-05 — Clarification request for ambiguous or missing data.md`

## Notes

- The interruption heuristic is intentionally conservative: a short answer like `"850"` or `"euros"` is treated as a clarification answer, while a full sentence with amount and currency (or a long message) is treated as a new expense.
- Currency options are capped at three to keep the reformulated question concise.
- The Telegram webhook route (`src/interfaces/http/routes/telegram.webhook.ts`) remains a thin delegate: it only parses the payload and enqueues jobs; no clarification logic lives in the HTTP layer.
