# Plan: Amount and currency detection fallback, clarification flow, and Telegram wiring

## Goal

Integrate the deterministic amount/currency extractor as a fallback in the expense-registration flow, fetch the user's `defaultCurrency` through a dedicated domain port, generate the correct clarification/confirmation messages, and wire everything into the existing Telegram pipeline so that E1-US-03 tasks T-E1-US-03-04 through T-E1-US-03-07 are complete and testable.

## Context

- T-E1-US-03-03 is already implemented as `src/application/services/ExtractAmountCurrency.ts` with its own value object `AmountCurrencyExtractionResult` and unit tests, but it is **not yet wired** into any use case.
- `src/application/use-cases/expense/RegisterExpense.ts` currently relies only on `LLMPort.extractExpense()`. It already handles missing `monto`/`moneda` by transitioning to `EXPENSE_CLARIFYING`, but it does not use the deterministic extractor as a fallback and does not handle zero-amount confirmation.
- The Telegram pipeline (`src/interfaces/http/routes/telegram.webhook.ts` -> `src/interfaces/workers/incomingMessage.worker.ts` -> `src/application/use-cases/conversation/RouteIncomingMessage.ts` -> `src/interfaces/workers/message.worker.ts`) already exists and delegates to `RegisterExpenseUseCase.interpret()`.
- `users.defaultCurrency` is already defined in `src/infrastructure/db/schema/index.ts` and returned by `DrizzleUserRepository.findById()`.
- Relevant documentation:
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-03-amount-and-currency-detection/E1-US-03 — Amount and currency detection.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-03-amount-and-currency-detection/tasks/T-E1-US-03-04.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-03-amount-and-currency-detection/tasks/T-E1-US-03-05.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-03-amount-and-currency-detection/tasks/T-E1-US-03-06.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-03-amount-and-currency-detection/tasks/T-E1-US-03-07.md`
  - `docs/features/incoming-message-routing.md`
  - `docs/features/conversation-state-management.md`
  - `docs/adr/adr.md` (ADR-002, ADR-003, ADR-005, ADR-008)
  - `AGENTS.md`

## Phases

### Phase 1: Application extraction core

Implement the deterministic fallback and default-currency lookup inside the Application layer so the expense interpretation use case can resolve ambiguous or missing amounts/currencies without touching Telegram-specific code.

- [x] Define `IUserProfilePort` in `src/domain/ports/` with a single method `getDefaultCurrency(userId: string): Promise<Currency | null>`.
- [x] Implement `DrizzleUserProfileRepository` in `src/infrastructure/db/repositories/` that delegates to the existing `DrizzleUserRepository.findById()` and returns only the currency (or null).
- [x] Modify `RegisterExpenseUseCase` constructor to accept `IUserProfilePort` instead of receiving `defaultCurrency` in the input.
- [x] Update `RegisterExpenseUseCase.interpret()` to:
  - Fetch the user's default currency via the port.
  - Call `LLMPort.extractExpense()` first.
  - If the LLM returns `monto === null` or `moneda === null`, call `ExtractAmountCurrency.execute(rawMessage, defaultCurrency)` as the deterministic fallback.
  - Map fallback results to the existing `needs_clarification` output for `amount-not-found`, `currency-not-found`, or `ambiguous-currency`.
  - Preserve existing category resolution and date resolution behavior when fallback succeeds.
- [x] Update `RegisterExpenseInput` to remove `defaultCurrency` since it is now fetched by the use case.
- [x] Update `src/bootstrap/buildDependencies.ts` to construct `DrizzleUserProfileRepository` and inject it into `RegisterExpenseUseCase`.
- [x] Update `src/interfaces/workers/message.worker.ts` to stop passing `defaultCurrency` to `registerExpense.interpret()` and instead pass only `userId`, `rawMessage`, and `channel`. Also updated the existing `message.worker.spec.ts` assertions that still expected `defaultCurrency: null`.
- [x] Add `src/application/use-cases/expense/RegisterExpense.spec.ts` with Vitest tests covering:
  - LLM succeeds with amount and currency -> `ready_for_review`.
  - LLM misses currency but user has default currency -> deterministic fallback resolves it.
  - LLM misses amount and fallback also misses it -> `needs_clarification` with `missingField: 'monto'`.
  - LLM/`$` symbol is ambiguous and default currency matches -> resolved.
  - LLM/`$` symbol is ambiguous without default currency -> `needs_clarification` with `missingField: 'moneda'`.
  - Default currency is fetched through the port (mock the port, not Drizzle).
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Channel wiring, zero-amount confirmation, and extraction coverage

Expose the new behavior through the Telegram pipeline, add the zero-amount confirmation path, and complete the unit-test coverage for the extractor.

- [x] Extend `RegisterExpenseUseCase.interpret()` return type to include `{ status: 'needs_zero_confirmation'; payload: ExpenseReviewPayload }`.
- [x] When the deterministic fallback or the LLM returns an amount of `0`, return `needs_zero_confirmation` instead of transitioning directly to `EXPENSE_REVIEW`.
- [x] Add `expenseCopies.zeroAmountConfirmation()` in `src/application/copies/expense.copies.ts` returning `"¿Querías registrar un gasto de $0?"`.
- [x] Update `src/interfaces/workers/message.worker.ts` to:
  - Handle `needs_zero_confirmation` from `registerExpense.interpret()` by sending the zero-amount confirmation copy and transitioning to `EXPENSE_REVIEW` with a payload flag `awaitingZeroConfirmation: true`.
  - Handle the confirmation reply in `EXPENSE_REVIEW` so that a confirm intent while `awaitingZeroConfirmation` is true proceeds to save (or currently to the existing `saving()` placeholder), and any other reply keeps the current summary behavior.
  - Keep sending the existing clarification copies for `needs_clarification`.
- [x] Add a new state payload shape documentation comment near `EXPENSE_REVIEW` handling for `awaitingZeroConfirmation`.
- [x] Update `src/interfaces/workers/message.worker.spec.ts` with tests for the zero-amount confirmation flow and for ambiguous-currency clarification messages being sent via Telegram.
- [x] Update `src/interfaces/http/routes/telegram.webhook.spec.ts` if needed to assert that ambiguous/zero-amount messages still result in HTTP 200 and are enqueued correctly.
- [x] Update `src/application/services/ExtractAmountCurrency.spec.ts` to reach ≥ 90% coverage of `ExtractAmountCurrency.execute`, adding missing cases such as:
  - Zero amount (`0`, `0.00`, `0,00`).
  - Ambiguous `$` with a default currency that is **not** in the candidate list.
  - Missing amount and missing currency combined.
  - Invalid amount format edge cases.
- [x] Run `pnpm test` to verify all tests pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. Review the final diff, then either commit the changes or export the conversation alongside the plan.
