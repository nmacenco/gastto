# Fix Repeated Undo Deletion

## Goal

Prevent a consumed immediate-undo token from authorizing deletion of an older expense. A second `deshacer` must not delete another record immediately and must follow the existing delayed-confirmation flow.

## Context

- [`src/interfaces/workers/message.worker.ts`](../../../src/interfaces/workers/message.worker.ts): Routes undo commands, reads `immediateUndoExpenseId`, and owns the FSM transitions that consume one-message eligibility.
- [`src/application/use-cases/expense/UndoLastExpense.ts`](../../../src/application/use-cases/expense/UndoLastExpense.ts): Defines `UndoLastExpenseInput` and selects the latest active expense before deciding whether confirmation is required.
- [`src/application/use-cases/conversation/TransitionConversationState.ts`](../../../src/application/use-cases/conversation/TransitionConversationState.ts): Persists the `IDLE` self-transition used to clear the consumed token.
- [`src/interfaces/workers/message.worker.spec.ts`](../../../src/interfaces/workers/message.worker.spec.ts): Covers worker routing, token clearing, delayed confirmation, and queued-review undo behavior.
- [`src/application/use-cases/expense/UndoLastExpense.spec.ts`](../../../src/application/use-cases/expense/UndoLastExpense.spec.ts): Covers immediate deletion, confirmation safety, and spreadsheet failure behavior.
- [`docs/testing/e2e-mvp/E2E-07-undo-last-expense.md`](../../../docs/testing/e2e-mvp/E2E-07-undo-last-expense.md): Defines the reported regression scenario with two consecutive undo commands.
- [`docs/features/undo-last-expense.md`](../../../docs/features/undo-last-expense.md): Canonical behavior requiring one-message immediate eligibility and explicit confirmation for a later undo.
- [`docs/adr/ADR-017-undo-confirmation-fsm.md`](../../../docs/adr/ADR-017-undo-confirmation-fsm.md): Requires a recognized immediate undo to consume eligibility and delayed undo to enter `EXPENSE_UNDO_CONFIRMING`.
- [`docs/architecture/fsm-states.md`](../../../docs/architecture/fsm-states.md): Defines FSM payload ownership and transition rules.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): Requires complete Undo coverage, negative assertions, and tests for every FSM transition.
- [`docs/typescript/explicit-undefined-optional-properties.md`](../../../docs/typescript/explicit-undefined-optional-properties.md): Governs the optional ID field under `exactOptionalPropertyTypes`.

The implementation currently reduces `immediateUndoExpenseId` to `immediateEligible: boolean`. The first immediate undo does not clear the persisted token, and the use case cannot verify that the token identifies the latest active record. After the first record is soft-deleted, the stale boolean therefore authorizes deletion of the next active record.

No database schema, external API, domain event, or user-facing copy changes are required. The functional documentation already specifies the intended behavior.

## Phases

### Phase 1: Bind immediate undo to one exact expense and consume its token

#### Description

Deliver the complete regression fix as one vertical slice across the application contract, worker routing, FSM persistence, and automated tests. Preserve the existing delayed-confirmation and spreadsheet-deletion behavior while making repeated undo safe.

#### To-do actions

- [x] Update the public application-service contract `UndoLastExpenseInput`: replace `immediateEligible: boolean` with `immediateExpenseId?: string | undefined`; retain `action` and `pendingExpenseId` so confirmed undo continues to validate the offered record.
- [x] Change `UndoLastExpenseUseCase.execute` so a request deletes immediately only when `immediateExpenseId` is present and exactly equals the latest non-deleted expense ID. Treat a missing or stale ID as `confirmation_required` for the current latest expense without creating a spreadsheet adapter, deleting a row, soft-deleting a record, or writing a successful deletion audit.
- [x] Update the `IDLE` undo route to capture the persisted `immediateUndoExpenseId`, consume it with an `IDLE` self-transition using `payload: null` before invoking the undo use case, and pass the exact captured ID instead of a boolean. If token consumption fails, do not invoke the destructive use case.
- [x] Update the `EXPENSE_REVIEW` queued-expense undo route to pass its captured exact ID after removing it from the preserved review payload, maintaining the current review and queue presentation behavior.
- [x] Update all remaining callers and mocks to omit `immediateExpenseId` when immediate eligibility is absent, following `exactOptionalPropertyTypes` conventions.
- [x] Extend `UndoLastExpense.spec.ts` with meaningful assertions for a matching immediate ID, an absent ID, and a stale or mismatched ID. Verify that stale and absent IDs require confirmation and cause no spreadsheet or local deletion side effects.
- [x] Extend `message.worker.spec.ts` to assert that immediate eligibility is cleared before the destructive call, the exact ID is forwarded in both supported routes, and delayed requests omit the field.
- [x] Add a sequential worker regression test for two consecutive `deshacer` messages: the first request consumes the token and reports deletion; the second request has no immediate ID, does not report another deletion, and transitions to `EXPENSE_UNDO_CONFIRMING` for the newly offered latest record.
- [x] Preserve and update existing failure-path tests so spreadsheet authorization, network, and structure failures still leave the local expense active while the one-message token remains consumed.
- [x] Run the focused suites with `pnpm test -- src/application/use-cases/expense/UndoLastExpense.spec.ts src/interfaces/workers/message.worker.spec.ts`, then run the complete `pnpm test` suite and fix any regressions.
- [ ] Re-run the manual E2E-07 scenario in a configured test environment. Confirm that the first undo removes only the newly saved expense and that the second command does not delete an older row without confirmation; record evidence in the E2E result section before marking it passed.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Re-run E2E-07 in the configured test environment, record the evidence, and then mark Phase 1 complete.
