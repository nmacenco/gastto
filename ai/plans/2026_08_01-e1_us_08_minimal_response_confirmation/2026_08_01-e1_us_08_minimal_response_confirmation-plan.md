# Plan: E1-US-08 - Confirm expense registration with a minimal response

## Goal

Implement text-based confirmation for an expense in `EXPENSE_REVIEW` using a fixed Spanish vocabulary. The flow must save immediately after a valid affirmation, route mixed replies to the existing correction flow, preserve the review on unknown replies, and keep the worker as a thin Interfaces-layer delegate.

## Context

### User story and task breakdown

- [E1-US-08 user story](</home/nicolasmacenco/NICO/gastto/docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-08-confirm-expense-registration-with-a-minimal-response/E1-US-08 — Confirm expense registration with a minimal response.md>): acceptance criteria and Definition of Done.
- [E1-US-08 tasks](</home/nicolasmacenco/NICO/gastto/docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-08-confirm-expense-registration-with-a-minimal-response/tasks>): task dependencies and estimates.
- [Dependency tree](</home/nicolasmacenco/NICO/gastto/docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-08-confirm-expense-registration-with-a-minimal-response/tasks/dependency-tree.md>): critical path for the five implementation tasks.

### Current code state

- [intents.ts](/home/nicolasmacenco/NICO/gastto/src/application/utils/intents.ts) already recognizes several confirmation words, but does not normalize regional accent variants and still allows confirmation classification directly from the worker.
- [message.worker.ts](/home/nicolasmacenco/NICO/gastto/src/interfaces/workers/message.worker.ts) currently resolves text confirmation, cancellation, and direct correction inside `handleExpenseReview()`. The worker must delegate text-reply business decisions to the Application layer.
- [ResolveExpenseSummaryActionUseCase.ts](/home/nicolasmacenco/NICO/gastto/src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts) already owns callback-action confirmation, correction, and cancellation. Its confirmation action invokes `RegisterExpenseUseCase.save()`.
- [CorrectExpenseUseCase.ts](/home/nicolasmacenco/NICO/gastto/src/application/use-cases/expense/CorrectExpenseUseCase.ts) already interprets and applies a correction from the pending review payload, returning a typed outcome and preserving an uninterpretable reply without mutation.
- [RegisterExpense.ts](/home/nicolasmacenco/NICO/gastto/src/application/use-cases/expense/RegisterExpense.ts) already executes the existing save contract: append the row, persist the internal expense record and audit log, transition to `IDLE`, and return the sheet location.
- [expense.copies.ts](/home/nicolasmacenco/NICO/gastto/src/application/copies/expense.copies.ts) has the existing ambiguity copy, which must change to the exact E1-US-08 text: `¿Confirmamos el registro tal como está, lo corregimos o lo cancelamos?`.

### Relevant documentation

- [AGENTS.md](/home/nicolasmacenco/NICO/gastto/AGENTS.md): Clean Architecture boundaries, documentation sync, and validation gates.
- [ADR index](/home/nicolasmacenco/NICO/gastto/docs/adr/adr.md): ADR-003 for the persisted FSM, ADR-005 and ADR-011 for the asynchronous worker pipeline, and ADR-006 for write-with-confirmation behavior.
- [Expense summary review feature](/home/nicolasmacenco/NICO/gastto/docs/features/expense-summary-review.md): current `EXPENSE_REVIEW` payload, callback behavior, and presenter responsibilities.
- [Expense correction feature](/home/nicolasmacenco/NICO/gastto/docs/features/expense-correction.md): existing direct correction entry point and its typed outcome contract.
- [Testing guidelines](/home/nicolasmacenco/NICO/gastto/docs/testing/guidelines.md): Vitest rules, FSM coverage, and mock boundaries.
- [Feature template](/home/nicolasmacenco/NICO/gastto/docs/features/TEMPLATE.md): format for the canonical feature document.

### Public contracts

- **Application service:** add `ResolveExpenseReviewReplyUseCase.execute(input): Promise<ResolveExpenseReviewReplyOutcome>` in `src/application/use-cases/expense/`.
  - Input: `userId`, `rawMessage`, `payload: ExpenseReviewPayload`, `chatId`, and `channel`.
  - Outcome: an action-handled result for confirmation/cancellation, or the existing `CorrectExpenseOutcome` for correction and uninterpretable replies.
  - The use case delegates confirmation/cancellation to `ResolveExpenseSummaryActionUseCase` and correction to `CorrectExpenseUseCase`; it must not duplicate spreadsheet persistence or provider-specific messaging.
- **Worker dependency contract:** add `resolveExpenseReviewReply: ResolveExpenseReviewReplyUseCase` to `MessageWorkerDeps`, `Dependencies`, dependency construction, worker registration, and their tests.
- **Confirmation intent contract:** update `isConfirmIntent(rawMessage)` to normalize case, whitespace, punctuation, and accent variants. A reply is confirmed only when it consists solely of an allowed affirmative phrase or a whitespace-separated sequence of allowed affirmation tokens. Mixed replies such as `comida sí, pero el monto no` must not confirm.
  - Standard vocabulary: `sí`, `si`, `ok`, `dale`, `confirmo`, `correcto`, `listo`, `va`.
  - Existing colloquial variants retained: `bárbaro`, `okey`, `perfecto`, `yep`, `sip`.
  - Regional coverage: Spain `vale`; Argentina `dale`, `bárbaro`; Mexico `va`, `órale`; Chile `ya`.
- **User-facing copy:** change `expenseCopies.ambiguousResponse()` to `¿Confirmamos el registro tal como está, lo corregimos o lo cancelamos?`.
- **Tests:** add an application-use-case suite and extend intent, worker, dependency-construction, and worker-registration suites for the new contract.
- **Documentation:** add `docs/features/expense-confirmation.md` and update `docs/features/README.md`.

No HTTP route, database schema, migration, external API, or messaging-port contract changes are required.

## Phases

### Phase 1 - Deliver the core text-confirmation vertical slice

Implement the application-layer resolver and wire it into the `EXPENSE_REVIEW` text path so a user can confirm with the standard vocabulary, correct a field, cancel, or receive the exact orientation prompt without the worker deciding business behavior.

- [x] Update `src/application/utils/intents.ts` and `intents.spec.ts` for standard confirmation words, case/whitespace/punctuation normalization, and negative classification of mixed correction text.
- [x] Create `src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase.ts` with its typed input, outcome, and dependencies.
  - Delegate valid text confirmation and cancellation to `ResolveExpenseSummaryActionUseCase`.
  - Build an `ExpenseCorrectionState` and delegate non-confirmation/non-cancellation text to `CorrectExpenseUseCase`.
  - Return the correction outcome unchanged so the caller can present an updated summary, a cycle-limit message, or the orientation prompt without re-implementing rules.
  - Preserve the review payload and state for a `not_interpretable` result.
- [x] Add `ResolveExpenseReviewReplyUseCase.spec.ts` covering standard confirmation, cancellation, partial correction, unknown input, and no duplicate save or state mutation.
- [x] Update `expenseCopies.ambiguousResponse()` and its assertions to use the exact E1-US-08 public copy.
- [x] Update `MessageWorkerDeps`, `Dependencies`, `buildDependencies.ts`, `registerWorkers.ts`, and their focused tests to inject the new use case.
- [x] Refactor `handleExpenseReview()` so its text branch validates the review payload, calls `ResolveExpenseReviewReplyUseCase` once, and only renders the returned correction outcome. Keep callback actions on the existing `ResolveExpenseSummaryActionUseCase` path.
- [x] Extend `message.worker.spec.ts` to verify a standard text confirmation reaches the application resolver, a partial correction does not call the save action, and unknown input keeps the review state while sending the exact orientation copy.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2 - Complete regional coverage, regression protection, and documentation

Expand the fixed regional vocabulary, prove the full user story through focused tests, and publish the canonical feature behavior and architecture boundary.

- [x] Add the approved regional variants and unaccented forms to `isConfirmIntent`, retaining existing compatible variants and rejecting partial-word false positives such as `daleeee`.
- [x] Extend `intents.spec.ts` with the complete standard and regional vocabulary, including Spain, Argentina, Mexico, and Chile coverage.
- [x] Extend `ResolveExpenseReviewReplyUseCase.spec.ts` and `message.worker.spec.ts` to cover every E1-US-08 Gherkin scenario:
  - valid standard confirmation starts the save path with no extra confirmation request;
  - valid regional confirmation starts the save path;
  - mixed confirmation/correction reaches E1-US-07 and saves nothing before explicit confirmation;
  - uninterpretable input sends the exact orientation copy and leaves state/payload unchanged.
- [x] Add regression assertions that callback Confirmar / Corregir / Cancelar, zero-amount confirmation, correction cycle limits, and high-amount review behavior remain unchanged.
- [x] Create `docs/features/expense-confirmation.md` from the feature template, documenting the fixed vocabulary, precedence rules, exact orientation copy, `EXPENSE_REVIEW` expectations, save delegation, test coverage, and the Interfaces-to-Application boundary.
- [x] Update `docs/features/README.md` with the new feature-document entry and links to E1-US-06, E1-US-07, E1-US-08, and E1-US-10 where relevant.
- [x] Run `pnpm test` to verify the complete test suite passes.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All implementation phases are complete; review the changes and, if desired, commit them before exporting the execution conversation alongside this plan.
