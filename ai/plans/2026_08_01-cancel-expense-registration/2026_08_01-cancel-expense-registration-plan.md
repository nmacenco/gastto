# E1-US-09: Cancel Expense Registration Safely

## Goal

Implement global text and inline cancellation for active expense-registration flows, leaving no pending state or saved expense data and allowing an immediate new registration.

## Context

- `src/domain/entities/ConversationState.ts`, `src/interfaces/workers/message.worker.ts`, and `src/application/use-cases/conversation/RouteIncomingMessage.ts` define the state and queue flow.
- `src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts` provides the existing review cancellation path.
- Follow `docs/features/conversation-state-management.md`, `docs/architecture/fsm-states.md`, ADR-003, ADR-005, ADR-011, and `docs/testing/guidelines.md`.
- No database migration is needed: active expense data lives in `conversation_states.state_payload`; confirmed expenses are the only records written to `expense_records`.

## Public Contract

- Add `CancelExpenseRegistrationUseCase` with a typed input that identifies the user, chat, current FSM state, and cancellation source (`text` or explicit callback).
- Return a typed outcome for `not_requested`, `cancelled`, or `no_active_expense`.
- Centralize the copies `Registro cancelado. No se guardó nada.` and `No hay ningún registro pendiente para cancelar.` in `expense.copies.ts`.
- Preserve the existing HTTP and queue payload contracts; no new route or schema is introduced.

## Phases

### Phase 1: Deliver shared expense-flow cancellation

Implement a user-visible vertical slice for `EXPENSE_RECEIVING`, `EXPENSE_CLARIFYING`, `EXPENSE_REVIEW`, and `EXPENSE_CORRECTING`.

- [x] Add the cancellation use case and typed outcome. It must own state cleanup, confirmation delivery through `MessagingOutputPort`, and the no-active-expense response.
- [x] Update FSM transition rules to permit each active expense-registration state to move to `IDLE` with `statePayload: null` and no expiration.
- [x] Reuse the shared use case from summary text replies and the Telegram Cancel callback.
- [x] Route supported text commands (`no`, `cancelar`, `cancela`, `no registres`, `para`, `stop`, `salir`) through the queued flow even from `IDLE`; bypass generic non-financial guidance only for these commands.
- [x] Invoke cancellation before clarification, review, correction, or new-expense handling so no LLM call, state mutation, or spreadsheet write starts after a recognized cancellation.
- [x] Wire the dependency through bootstrap types, dependency construction, and worker registration without introducing Telegram-specific business logic into application code.
- [x] Add unit and worker tests for every active expense state, the idle response, global commands, callback regression, cleanup-before-response ordering, and an immediate subsequent expense.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Prove rollback and synchronize canonical documentation

Harden the behavior with persistence-focused tests and update the feature documentation that defines the contract.

- [x] Add an integration test using the PostgreSQL conversation-state repository that seeds active expense payloads, cancels them, and asserts `IDLE`, `statePayload: null`, `expiresAt: null`, and no `expense_records` creation.
- [x] Cover the immediate-new-expense scenario after cancellation to prove the prior payload cannot be reused.
- [x] Create `docs/features/expense-cancellation.md` with the supported vocabulary, state scope, copies, callback behavior, no-active-flow response, and test coverage.
- [x] Update `docs/features/README.md`, `docs/features/conversation-state-management.md`, `docs/features/expense-summary-review.md`, and `docs/architecture/fsm-states.md` to reflect the shared cancellation path and new valid transitions.
- [x] Mark the satisfied acceptance criteria in `T-E1-US-09-01.md` through `T-E1-US-09-05.md` after the implementation and tests are complete.
- [x] Run `pnpm test`, `pnpm run lint`, and `pnpm run typecheck`; fix any failures.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Assumptions

- Cancellation applies only to expense-registration states, not onboarding flows.
- The no-active-expense copy is exactly: `No hay ningún registro pendiente para cancelar.`

## Next Step

All plan phases are complete.
