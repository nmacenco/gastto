# E1-US-12: Save Failure Recovery

## Goal

Implement reliable, user-visible recovery for failed Google Sheets expense saves. The feature must classify write failures, retain the confirmed expense for ten minutes, offer one user-initiated retry, route reauthorization and remapping, and never send a save-success confirmation for an unconfirmed write.

## Context

- User-story tasks: [`E1-US-12 tasks`](../../../docs/user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-12-save-failure-notification-with-resolution-instructions/tasks/).
- Save orchestration: [`RegisterExpense.ts`](../../../src/application/use-cases/expense/RegisterExpense.ts) and [`ResolveExpenseSummaryActionUseCase.ts`](../../../src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts).
- Message routing and state transitions: [`message.worker.ts`](../../../src/interfaces/workers/message.worker.ts) and [`ConversationState.ts`](../../../src/domain/entities/ConversationState.ts).
- Relevant decisions and conventions: [`ADR-006`](../../../docs/adr/adr.md#adr-006--confiabilidad-del-guardado-write-with-confirmation--retry), [`FSM states`](../../../docs/architecture/fsm-states.md), [`expense confirmation`](../../../docs/features/expense-confirmation.md), and [`testing guidelines`](../../../docs/testing/guidelines.md).

The active expense-saving runtime is Google Sheets only: bootstrap wires `GoogleSheetsAdapterFactory`, `RegisterExpense.save()` rejects other providers, and Excel append support remains an E4 dependency. No database migration is planned because retry data belongs in the existing `conversation_states.state_payload` JSONB column and failures use existing `operation_logs` types.

## Phase 1: Classify and surface failed Google saves

Deliver an immediate, user-visible recovery message after an unsuccessful Google Sheets append while preventing creation of a success record or E1-US-10 confirmation.

- [x] Extend `SpreadsheetError` with a typed write-failure code: `NETWORK_ERROR`, `AUTH_ERROR`, `STRUCTURE_ERROR`, or `UNKNOWN`, plus retryability metadata. Keep Google HTTP/network mapping in Infrastructure.
- [x] Map Google append network errors, HTTP 401/403 responses, malformed provider responses, missing sheets, and missing/stale mappings to the typed failure contract.
- [x] Add a domain retry-payload type containing the confirmed `ExpenseReviewPayload`, failure code, first-attempt timestamp, and attempt count.
- [x] Update the confirmation save orchestration to transition `EXPENSE_REVIEW` to `EXPENSE_SAVING`, audit `EXPENSE_SAVE_FAILED`, and persist `EXPENSE_SAVING_RETRY` with a ten-minute expiry for retryable network failures.
- [x] Add centralized Spanish copies for network failure, authorization failure, structure failure, expired retry state, and manual-copy fallback. Failed saves must never create an `expense_records` row, invoke `expenseSavedConfirmation`, or transition directly to `IDLE`.
- [x] Add focused domain, adapter, and Application tests for classification, retry-state persistence, and the no-success-on-failure invariant.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Public contracts

- `SpreadsheetError` exposes a typed failure code and retryability metadata without leaking Google response details into Application code.
- A typed retry-state payload is persisted only while the FSM is `EXPENSE_SAVING_RETRY`.
- New centralized copy functions define the exact user-facing failure and recovery messages.

## Phase 2: Add user-driven retry and resolution routing

Complete the conversational recovery loop from `EXPENSE_SAVING_RETRY` while keeping the worker as a thin Interfaces adapter.

- [x] Add `RetryExpenseSaveUseCase.execute(...)` to validate the persisted retry payload, perform exactly one user-initiated append attempt after `reintentar`, send E1-US-10 confirmation exactly once on success, and send the formatted manual-copy fallback after a second failure.
- [x] Extend FSM transitions so `EXPENSE_SAVING_RETRY` can move to `IDLE` after success or terminal fallback, and to `ONBOARDING_VALIDATING_ACCESS` when reconfiguration starts.
- [x] Route `reintentar` only in `EXPENSE_SAVING_RETRY`; it must delegate to the new Application use case without re-running NLP or calling spreadsheet adapters from `message.worker.ts`.
- [x] Add `StartSpreadsheetReconfigurationUseCase.execute(...)`: load the active Google spreadsheet configuration, build the existing validation payload, transition to `ONBOARDING_VALIDATING_ACCESS`, and invoke the existing validation and eager column-inference path.
- [x] Route `reconfigurar` only in `EXPENSE_SAVING_RETRY` to the reconfiguration use case. Route expired or malformed retry state to a clear restart/manual-resolution response after clearing state.
- [x] Make `empezar` an accepted Google provider-selection alias in `InitiateCloudConnection`, so an authorization-failure message gives a real one-step path to a fresh OAuth link.
- [x] Add Application and worker tests for successful retry, second failed retry, reauthorization, remapping, invalid retry input, and expired state.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Public contracts

- `RetryExpenseSaveUseCase.execute(...)` and `StartSpreadsheetReconfigurationUseCase.execute(...)` are Application-layer entry points.
- `reintentar` and `reconfigurar` are contextual text commands accepted only in `EXPENSE_SAVING_RETRY`.
- `empezar` becomes a supported Google selection alias in the existing onboarding input contract.

## Phase 3: Verify, document, and close the story

Prove the silent-failure invariant, document the chosen retry semantics, and synchronize the backlog with the implementation.

- [x] Add an integration test proving that a failed append emits recovery copy, does not create an expense record, and never emits E1-US-10 successful-save confirmation.
- [x] Run the relevant Vitest suites and the full `pnpm test` suite. Keep mocks at provider, messaging, Redis, and database boundaries only.
- [x] Update [`expense-confirmation.md`](../../../docs/features/expense-confirmation.md) to replace the E1-US-12 TODO with implemented behavior, then update [`docs/features/README.md`](../../../docs/features/README.md).
- [x] Update [`fsm-states.md`](../../../docs/architecture/fsm-states.md) with the retry payload and the reconfiguration transition.
- [x] Add an ADR that supersedes ADR-006's automatic-write-retry wording: retries are user-initiated and limited to one reattempt because append timeouts are not idempotent. Update [`docs/adr/README.md`](../../../docs/adr/README.md).
- [x] Check off satisfied acceptance criteria in `T-E1-US-12-01.md` through `T-E1-US-12-06.md` after all implementation and verification work is complete.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Assumptions

- This story implements Google Sheets recovery only; Excel save and recovery remain blocked by E4.
- `reintentar` performs one manual resend. A network timeout after Google has accepted the write retains an at-least-once duplication risk; the superseding ADR documents this limitation.
- No HTTP route, OpenAPI schema, database schema, or migration changes are required.
- All user-facing text remains owned by Application copy modules, and all external-trigger handlers only deserialize, validate, and delegate.

## Next step

Phase 3 is ready for user review and an optional commit.
