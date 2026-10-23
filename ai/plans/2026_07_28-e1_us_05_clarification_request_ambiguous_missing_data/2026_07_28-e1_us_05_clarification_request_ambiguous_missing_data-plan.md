# Plan: E1-US-05 — Clarification request for ambiguous or missing data

## Goal

Implement the clarification flow for expense messages with missing or ambiguous amount/currency data. The system must ask for exactly one missing piece at a time, preserve the partial expense context across conversation turns, allow interruption by a new expense, and reformulate the question when the user answers invalidly.

## Context

### User story

E1-US-05 asks for a single-question clarification mechanism when an expense message is incomplete or ambiguous. The main complexity is conversational state management across turns, not the question itself.

### Relevant documentation

- `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-05-clarification-request-for-ambiguous-or-missing-data/E1-US-05 — Clarification request for ambiguous or missing data.md` — acceptance criteria and definition of done.
- `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-05-clarification-request-for-ambiguous-or-missing-data/tasks/dependency-tree.md` — task dependencies and critical path.
- `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-05-clarification-request-for-ambiguous-or-missing-data/tasks/T-E1-US-05-01.md` through `T-E1-US-05-08.md` — atomic implementation tasks.
- `docs/adr/adr.md` — ADR-003 (FSM in PostgreSQL), ADR-005 (async BullMQ pipeline).
- `AGENTS.md` — useful commands, lint/typecheck/test gates, DB conventions, documentation sync rules.

### Current code state

- `src/application/use-cases/expense/RegisterExpense.ts` already branches into `needs_clarification` for `monto` or `moneda` and persists a 30-minute TTL state via `transitionToClarifying()`.
- `src/interfaces/workers/message.worker.ts` already routes `EXPENSE_CLARIFYING` to `handleClarification()` and re-interprets the enriched message `"${originalMessage} ${userResponse}"`.
- The FSM and `src/infrastructure/db/schema/index.ts` already support `EXPENSE_CLARIFYING` with transitions to `EXPENSE_REVIEW` and `IDLE`.
- `src/application/copies/expense.copies.ts` already has `clarificationAmount()` and `clarificationCurrency()`.
- The gaps are: typed state payload, explicit priority enforcement, interruption handling, invalid-answer reformulation, and integration tests for those scenarios.

### Public contracts

- **Domain value object:** `ExpenseClarificationState` in `src/domain/value-objects/expense-clarification-state.ts` exposing `missingField`, `partialExtracted`, and `rawMessage` with (de)serialization.
- **Application use-case return type:** `RegisterExpense.interpret()` returns `{ status: 'needs_clarification'; missingField: 'monto' | 'moneda' }` with priority amount > currency > category.
- **Application helper:** heuristic to distinguish a new expense message from a clarification answer.
- **User-facing copies:** `expenseCopies.clarificationInterrupted()` and `expenseCopies.clarificationReformulation(options: string[])`.
- **FSM transitions:** `EXPENSE_CLARIFYING` -> `IDLE` -> `EXPENSE_RECEIVING` for interruption; `EXPENSE_CLARIFYING` -> `EXPENSE_REVIEW` for resolution; `EXPENSE_CLARIFYING` -> `EXPENSE_CLARIFYING` for reformulation.
- **Tests:** additions to `src/interfaces/workers/message.worker.spec.ts` and new unit tests for the value object and helper.
- **Feature documentation:** new `docs/features/clarification-request.md` and update to `docs/features/README.md`.

## Phases

### Phase 1 — Domain model and single-missing-field clarification trigger

Vertical slice: formalize the state payload and harden the trigger logic so the system reliably asks for exactly one missing field.

- [x] Create `src/domain/value-objects/expense-clarification-state.ts` with `ExpenseClarificationState`.
  - Fields: `missingField: 'monto' | 'moneda'`, `partialExtracted: ExtractedExpense`, `rawMessage: string`.
  - Immutable, validated on construction.
  - `toPayload(): Record<string, unknown>` and `static fromPayload(payload: unknown): ExpenseClarificationState` for JSONB storage.
  - Export `isExpenseClarificationState(payload: unknown): payload is ExpenseClarificationState` guard.
- [x] Add unit tests for `ExpenseClarificationState` construction, serialization, and deserialization.
- [x] Update `src/domain/value-objects/index.ts` to re-export the new value object if the project uses an index barrel.
- [x] Refactor `RegisterExpense.transitionToClarifying()` to use `ExpenseClarificationState`.
- [x] Harden priority enforcement in `RegisterExpense.interpret()`:
  - amount > currency > category.
  - Low category confidence proceeds to `EXPENSE_REVIEW` without additional clarification.
- [x] Add unit tests for `RegisterExpense.interpret()` covering all combinations of missing/ambiguous fields and the priority order.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2 — Response handling, interruption, and reformulation

Vertical slice: complete the user-facing response paths (sequential clarification, new-expense interruption, invalid-answer reformulation).

- [x] Update `handleClarification()` in `src/interfaces/workers/message.worker.ts` to use the typed `ExpenseClarificationState`.
- [x] Support sequential missing fields: when the user answers the amount question but currency is still missing, re-interpret and ask for currency.
- [x] Preserve the original message context across turns by reusing the `rawMessage` and accumulated response in the state payload.
- [x] Implement interruption detection in `EXPENSE_CLARIFYING`:
  - If the incoming message looks like a new complete expense (e.g., contains both amount-like and currency-like tokens or is longer than a plausible short answer), transition to `IDLE`, send the cancellation notification, and re-process the message as a new expense.
  - Otherwise, continue with `handleClarification()`.
- [x] Add `expenseCopies.clarificationInterrupted()` returning a brief cancellation notice: `El registro anterior fue cancelado. Procesando el nuevo gasto…`.
- [x] Implement invalid-answer reformulation:
  - Detect "no sé" variants using a shared `isIdkVariant()` helper.
  - Gather currency options from the user's default currency and previously used currencies via `IUserProfilePort` and `IExpenseRecordRepository`.
  - Add `expenseCopies.clarificationReformulation(options: string[])` returning a concrete question.
- [x] Preserve the `EXPENSE_CLARIFYING` state when reformulating (do not discard the flow).
- [x] Add unit tests for the interruption heuristic and the invalid-answer detection.
- [x] Add copy tests for `clarificationInterrupted()` and `clarificationReformulation()`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3 — Integration wiring and tests

Vertical slice: verify the end-to-end pipeline, add missing integration tests, and document the feature.

- [x] Verify the Telegram webhook route (`src/interfaces/http/routes/webhook/telegram.ts`) remains a thin delegate with no clarification business logic.
- [x] Confirm `message.worker.ts` routes `EXPENSE_CLARIFYING` correctly and that new interruption/reformulation paths are wired through the worker.
- [x] Add integration tests to `src/interfaces/workers/message.worker.spec.ts`:
  - New expense interrupts previous clarification: previous flow discarded, cancellation sent, new expense processed.
  - Invalid response reformulation: user answers "no sé" to currency question and receives reformulated options.
  - Sequential missing fields: amount provided first, then currency asked next.
  - All six Gherkin scenarios from the user story are covered by at least one test.
- [x] Add unit tests for `RegisterExpense.interpret()` sequential flow and `EXPENSE_CLARIFYING` TTL.
- [x] Create `docs/features/clarification-request.md` documenting the feature, the priority order, the timeout, and the interruption heuristic.
- [x] Update `docs/features/README.md` to add the new feature doc.
- [x] Run `pnpm run test` to verify the test suite passes.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. Review the changes, close the plan, and update the related user-story task files under `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-05-clarification-request-for-ambiguous-or-missing-data/tasks/` by checking off the acceptance criteria that were satisfied.
