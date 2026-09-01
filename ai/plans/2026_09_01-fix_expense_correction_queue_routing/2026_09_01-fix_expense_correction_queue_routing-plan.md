# Fix Expense Correction Queue Routing

## Goal

Ensure that natural-language corrections made during expense review update the active expense instead of being admitted as new queued expenses. Keep genuine additional expenses queueable and make every pending-expense queue response consistent with the Spanish conversation.

## Context

- [`src/interfaces/workers/message.worker.ts`](../../../src/interfaces/workers/message.worker.ts): Routes messages by FSM state and currently applies the narrow `isLikelyExpenseCorrection` regular expression before contextual correction interpretation.
- [`src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase.ts`](../../../src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase.ts): Owns confirmation, cancellation, and correction precedence for text replies in `EXPENSE_REVIEW`.
- [`src/application/use-cases/expense/CorrectExpenseUseCase.ts`](../../../src/application/use-cases/expense/CorrectExpenseUseCase.ts): Applies contextual LLM correction suggestions and returns typed outcomes.
- [`src/application/use-cases/expense/QueuePendingExpense.ts`](../../../src/application/use-cases/expense/QueuePendingExpense.ts): Admits genuine additional expenses without mutating the active FSM payload.
- [`src/domain/ports/services.ts`](../../../src/domain/ports/services.ts): Defines the provider-neutral `ExpenseCorrectionSuggestion` and `LLMPort.interpretCorrection` contracts.
- [`src/infrastructure/adapters/llm/OpenAIAdapter.ts`](../../../src/infrastructure/adapters/llm/OpenAIAdapter.ts), [`src/infrastructure/adapters/llm/ClaudeAdapter.ts`](../../../src/infrastructure/adapters/llm/ClaudeAdapter.ts), and [`src/infrastructure/adapters/llm/NvidiaAdapter.ts`](../../../src/infrastructure/adapters/llm/NvidiaAdapter.ts): Implement the strict correction schema and contextual prompts for each supported provider.
- [`src/application/copies/expense.copies.ts`](../../../src/application/copies/expense.copies.ts): Contains pending-expense queue messages that are currently written in English.
- [`docs/testing/e2e-mvp/E2E-04-correct-expense-before-saving.md`](../../../docs/testing/e2e-mvp/E2E-04-correct-expense-before-saving.md): Records the connected failure for `eran 35 EUR y la categoria es transporte` and the unexpected switch to English.
- [`docs/adr/adr.md`](../../../docs/adr/adr.md): ADR-002 defines LLM extraction behind a provider-neutral port, ADR-003 defines the persisted FSM, and ADR-005 defines asynchronous BullMQ processing.
- [`docs/architecture/fsm-states.md`](../../../docs/architecture/fsm-states.md) and [`docs/architecture/async-pipeline.md`](../../../docs/architecture/async-pipeline.md): Define correction transitions, per-user processing, and queue behavior.
- [`docs/features/expense-correction.md`](../../../docs/features/expense-correction.md), [`docs/features/expense-confirmation.md`](../../../docs/features/expense-confirmation.md), [`docs/features/conversation-state-management.md`](../../../docs/features/conversation-state-management.md), and [`docs/features/README.md`](../../../docs/features/README.md): Define the canonical behavior and documentation index that must remain synchronized.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): Requires meaningful FSM assertions, queue overflow negative assertions, and boundary-only mocks.

## Phases

### Phase 1: Contextual correction and queue-intent routing

**Description:** Replace lexical correction guessing in active review flows with one provider-neutral contextual interpretation that distinguishes a correction from a genuine new expense or an unrelated reply, while preserving FIFO admission and the active FSM payload.

- [x] Change the public `ExpenseCorrectionSuggestion` contract from `interpretable: boolean` to `intent: 'correction' | 'new_expense' | 'unrelated'`, retaining the existing corrected-field values for the `correction` branch.
- [x] Update the strict Zod schemas and correction prompts in the OpenAI, Claude, and NVIDIA adapters so `eran 35 EUR y la categoria es transporte` is classified as a multi-field correction, a standalone message such as `Taxi 12 EUR` is classified as a new expense, and unrelated replies do not invent changes.
- [x] Update `CorrectExpenseOutcome` to expose a typed `new_expense` result while preserving `not_interpretable`, `cycle_limit`, `high_amount_confirmation`, and `corrected` behavior.
- [x] Extend `ResolveExpenseReviewReplyUseCase` to keep confirmation and cancellation precedence, apply a contextual correction exactly once, and delegate only the typed `new_expense` result to `QueuePendingExpense`.
- [x] Extend the review-reply outcome contract with explicit `expense_queued` and `queue_full` variants so the worker only renders outcomes and does not decide correction intent with a regular expression.
- [x] Remove `isLikelyExpenseCorrection` from `EXPENSE_REVIEW` and `EXPENSE_CORRECTING` queue admission. Retain the existing clarification-specific new-expense protection unless its tests show that it must use the new typed intent as well.
- [x] Preserve the current expense review payload, correction cycle count, per-user lock, duplicate-message handling, FIFO order, and two-item queue limit across every branch.
- [x] Add provider adapter tests for `eran 35 EUR y la categoria es transporte`, genuine additional-expense intent, unrelated input, strict-schema rejection, and no invented corrected fields.
- [x] Add application and worker regression tests proving that the reported correction updates amount to `35` and category to the configured transport value, produces one updated summary, does not call `QueuePendingExpense`, and leaves the spreadsheet unsaved until confirmation.
- [x] Keep regression coverage proving that a genuine additional expense is queued once without invoking correction mutation and that queue overflow does not change the active review.
- [x] Update `docs/features/expense-correction.md` and `docs/features/expense-confirmation.md` with the implemented contextual intent precedence, then update `docs/features/README.md` as required by the documentation index rule.
- [x] Run the targeted Vitest suites for correction use cases, all three LLM adapters, and `message.worker.spec.ts`; fix issues if any.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Spanish queue responses and connected regression verification

**Description:** Remove the language regression from every pending-expense queue state and verify the complete correction journey, including recovery messages after unrelated input.

- [x] Replace the public queue copies with Spanish equivalents for queue-full rejection, pending-count notice, non-financial reminder, expiration advance, and final batch summary.
- [x] Use the exact non-financial reminder contract `Todavía tenés un gasto pendiente de confirmación y {pendingCount} más en la cola. ¿Querés confirmar, corregir o cancelar el actual?`, applying correct singular and plural grammar to every count-aware copy.
- [x] Add copy tests that reject the former English text and assert the complete Spanish output for singular, plural, full-queue, expiration, and closing-summary variants.
- [x] Add worker regression coverage for the reported sequence: active taxi review, `eran 35 EUR y la categoria es transporte`, updated review, and a later unrelated reply, asserting no hang, no extra queued correction, one response per processed message, and Spanish-only user-visible output.
- [x] Verify the test also proves that no spreadsheet row is written after correction and that explicit confirmation writes exactly one row containing amount `35`, never the original amount `30`.
- [x] Update `docs/features/conversation-state-management.md`, the relevant queue behavior in `docs/features/expense-confirmation.md`, and `docs/features/README.md` with the implemented Spanish copy and routing guarantees.
- [x] Keep E2E-04 unchecked until the connected Telegram and Google Sheets execution passes. After implementation, ask the tester to rerun the documented case and record the new date, evidence, row count, corrected row values, and language result.
- [x] Run the complete `pnpm test` suite and fix failures without weakening meaningful assertions.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All implementation phases are complete; rerun connected E2E-04 and record the observed Telegram and Google Sheets evidence.
