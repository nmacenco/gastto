# Plan: Correct Expense Fields in Natural Language

## Goal

Complete E1-US-07 so a user can correct amount, currency, category, or date from an expense-review summary using natural language. Corrections must be applied atomically, re-present one updated summary for explicit confirmation, and remain unsaved until confirmation.

## Context

- [E1-US-07 user story](../../../docs/user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-07-correct-an-erroneous-field-in-natural-language/E1-US-07%20%E2%80%94%20Correct%20an%20erroneous%20field%20in%20natural%20language.md): Acceptance criteria and Definition of Done.
- [Task backlog](../../../docs/user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-07-correct-an-erroneous-field-in-natural-language/tasks/): Source tasks T-E1-US-07-01 through T-E1-US-07-07 and their dependency tree.
- [ADR-002](../../../docs/adr/adr.md#adr-002--nlp-llm-con-extracci%C3%B3n-estructurada-v%C3%ADa-puerto-abstracto): LLM access stays behind the `LLMPort` adapter boundary.
- [ADR-003](../../../docs/adr/adr.md#adr-003--estado-conversacional-fsm-persistida-en-postgresql): `EXPENSE_REVIEW` and `EXPENSE_CORRECTING` are durable FSM states.
- [Expense summary review feature](../../../docs/features/expense-summary-review.md): Existing review presentation, inline actions, and high-amount behavior to extend without duplicating.
- [Clarification request feature](../../../docs/features/clarification-request.md): Typed state-payload and worker validation patterns to follow.
- [Testing guidelines](../../../docs/testing/guidelines.md): Vitest placement, mock-boundary rules, and FSM coverage requirements.
- [Plan conventions](../../../docs/plans/plan-conventions.md): Required plan structure and per-phase verification steps.

The worktree already contains partial, uncommitted implementation for the correction state value object, correction LLM port and adapters, `CorrectExpenseUseCase`, copies, and related unit tests. The plan treats that work as the starting point and requires verification against the story before it is considered complete. The worker currently has no `EXPENSE_CORRECTING` route, no correction-use-case dependency, and no correction integration coverage; the canonical feature document and index entry are also absent.

## Phases

### Phase 1: Complete and validate the correction core

Deliver the domain and application behavior that turns a contextual natural-language correction into an updated review payload, with no messaging or worker orchestration embedded in the use case.

Public contracts changed in this phase:

- `ExpenseCorrectionState` in `src/domain/value-objects/expense-correction-state.ts`: immutable, serializable `EXPENSE_CORRECTING` payload with `payload`, `correctionCycles`, `pendingHighAmountConfirmation`, and `MAX_CORRECTION_CYCLES = 5`.
- `LLMPort.interpretCorrection(rawMessage, currentExtracted, userContext)` and `ExpenseCorrectionSuggestion` in `src/domain/ports/services.ts`.
- `CorrectExpenseUseCase.execute(input)` and its discriminated outcomes in `src/application/use-cases/expense/CorrectExpenseUseCase.ts`.
- Correction copies in `src/application/copies/expense.copies.ts`.

To-do:

- [x] Reconcile the in-progress `ExpenseCorrectionState` and `ExpenseReviewPayload` with T-E1-US-07-01, including strict reconstruction from JSONB, immutability, validation, cycle incrementing, and correct placement of high-amount confirmation state.
- [x] Verify the three LLM adapters implement the same strict correction schema and prompt contract: current review context, changed-fields-only output, an uninterpretable response, and multi-field corrections.
- [x] Complete `CorrectExpenseUseCase` so it resolves category vocabulary through `ICategoryClassifier`, resolves supported relative dates, applies all requested fields in one payload update, resets review TTL, enforces the five-cycle limit, and requests high-amount confirmation before applying the corrected value.
- [x] Ensure no correction is persisted or sent through a messaging adapter by the use case; it may only use domain/application ports and transition conversation state.
- [x] Align and complete value-object, adapter, use-case, and copy tests for every core scenario: amount, currency, category, date, multi-field, uninterpretable input, high amount, cycle limit, serialization, and TTL reset.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Deliver the correction conversation flow

Wire the completed correction core into dependency construction and message processing so corrections work from both the inline Correct action and free text in the review state.

Public contracts changed in this phase:

- `MessageWorkerDeps` in `src/interfaces/workers/message.worker.ts`: adds the injected `CorrectExpenseUseCase` dependency.
- Bootstrap dependency composition in `src/bootstrap/buildDependencies.ts` and its exposed dependency types.
- FSM behavior: `EXPENSE_CORRECTING` accepts the next correction message and successful corrections transition to `EXPENSE_REVIEW` with the refreshed review payload.

To-do:

- [x] Register `CorrectExpenseUseCase` in the bootstrap composition root with the selected LLM port, category classifier, repositories, and `TransitionConversationState`.
- [x] Add an `EXPENSE_CORRECTING` branch and a thin `handleExpenseCorrection()` worker helper that deserializes `ExpenseCorrectionState`, logs invalid state structurally, delegates to the use case, and presents the appropriate outcome.
- [x] Update the free-text path in `handleExpenseReview()` to validate the review payload and attempt a correction before using `ambiguousResponse()` for an uninterpretable message.
- [x] Preserve callback confirm/cancel/correct behavior. The Correct callback must create the typed correction state and send the natural-language prompt; confirm and cancel must continue to use the existing summary action flow.
- [x] Route successful corrections through `presentExpenseSummary()` exactly once, including the existing high-amount presentation path. For a high amount, request explicit confirmation without saving the updated expense.
- [x] Add worker-level tests for both entry points, corrupted correction state recovery, uninterpretable correction, cycle limit, high-amount confirmation, and exactly one updated summary for a multi-field correction.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Verify delivery and document the implemented feature

Prove the end-to-end behavior against the user story, document only what is implemented, and synchronize the backlog after all acceptance criteria pass.

Public contracts changed in this phase:

- [Expense correction feature documentation](../../../docs/features/expense-correction.md): canonical description of the implemented interaction and architectural boundaries.
- [Feature index](../../../docs/features/README.md): adds the expense-correction entry.

To-do:

- [x] Run the correction-focused unit and worker tests, then run the complete `pnpm test` suite; resolve regressions without mocking correction business logic.
- [x] Create `docs/features/expense-correction.md` from the feature template, documenting both entry points, correctable fields, atomic multi-field behavior, high-amount confirmation, five-cycle limit, no-save-until-confirmation rule, and the worker/use-case/LLM-port boundary.
- [x] Map each E1-US-07 Gherkin scenario to its covering test and update `docs/features/README.md` with the new canonical document.
- [x] Review all seven source task files and check only the acceptance criteria demonstrated by the completed implementation and tests.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete; no further implementation steps remain for E1-US-07.
