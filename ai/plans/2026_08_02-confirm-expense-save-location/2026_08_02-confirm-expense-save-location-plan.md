# Goal

Send a trustworthy expense-save confirmation that identifies the persisted expense by concept, amount, currency, sheet, and row when the spreadsheet provider confirms that metadata. Preserve a safe sheet-only confirmation when the row is unavailable, and never send a success confirmation after a failed save.

# Context

- [E1-US-10 task decomposition](../../../docs/user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-10-confirm-saving-with-reference-to-spreadsheet-location/tasks/): Approved tasks, dependencies, and 9.5-hour estimate.
- [RegisterExpense use case](../../../src/application/use-cases/expense/RegisterExpense.ts): Owns the save orchestration, persists the spreadsheet reference, and currently requires a row index in its returned result.
- [ResolveExpenseSummaryActionUseCase](../../../src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts): Sends the saving message, invokes the save operation, and currently sends the generic successful-save copy.
- [Spreadsheet service port](../../../src/domain/ports/services.ts): Defines `SpreadsheetPort` and its `appendRow()` result contract.
- [GoogleSheetsAdapter](../../../src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts): Implements the provider boundary; `appendRow()` is currently a placeholder.
- [Expense copy module](../../../src/application/copies/expense.copies.ts): Canonical Application-layer location for user-facing expense messages.
- [Composition root](../../../src/bootstrap/buildDependencies.ts): Wires the expense use cases and spreadsheet adapter; it currently marks save wiring as incomplete.
- [Expense-confirmation feature documentation](../../../docs/features/expense-confirmation.md): Documents the E1-US-08 confirmation flow and links this save path.
- [ADR-004](../../../docs/adr/ADR-004-spreadsheet-adapter.md): Requires provider-specific Infrastructure adapters behind the common spreadsheet port.
- [ADR-006](../../../docs/adr/ADR-006-write-confirmation.md): Requires the write-with-confirmation pattern, persisted sheet/row reference, and the E1-US-12 failure branch.
- [ADR-012](../../../docs/adr/ADR-012-user-facing-text-copies.md): Requires user-facing text to be owned by Application copy modules, rather than adapters.
- [Testing guidelines](../../../docs/testing/guidelines.md): Requires meaningful Vitest coverage with mocks only at external boundaries.
- [TypeScript optional-property convention](../../../docs/typescript/explicit-undefined-optional-properties.md): Governs how an optional row index is represented under `exactOptionalPropertyTypes`.

# Phases

## Phase 1: Persist confirmed spreadsheet-location metadata

Implement the provider-backed append path and make the save-location contract accurately represent a confirmed row when available. This phase produces a runnable successful write path that persists the confirmed sheet/row reference for later confirmation and undo work.

**Public contracts:**

- Modify `SpreadsheetPort.appendRow()` to return a typed success value with `sheet` and optional `row`.
- Modify `RegisterExpenseUseCase.save()` to expose a typed `sheetName` and optional `rowIndex` result while persisting the confirmed metadata.

- [x] Inspect the existing `SpreadsheetPort`, provider response parsers, spreadsheet configuration, and column mapping to define the smallest provider-neutral append result.
- [x] Implement Google Sheets `appendRow()` using the provider append endpoint, safely parse the returned updated range, and return the actual sheet and row only after a successful response.
- [x] Preserve a successful sheet-only result when the provider confirms the write but omits a determinable row; do not manufacture a row number.
- [x] Adapt `RegisterExpenseUseCase.save()` and its persistence/logging calls to handle the optional row according to the project TypeScript convention while retaining the `EXPENSE_SAVING` to `IDLE` success transition.
- [x] Update dependency wiring so the save use case receives a token-aware spreadsheet port instead of the current placeholder adapter, reusing existing provider/configuration boundaries.
- [x] Generate the non-destructive migration that makes `expense_records.row_index` nullable and update `docs/architecture/data-model.md`.
- [x] Add unit tests for the port result and Google adapter: single-sheet append, selected multi-sheet append, no-row success, provider HTTP error, invalid response, and network error.
- [x] Run linting and typechecking through the local project binaries because the installed `pnpm` executable cannot open its database file. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 2: Deliver the location-aware successful confirmation

Use the confirmed save result to deliver a readable confirmation after the existing user confirmation flow, with all business decisions remaining in the Application layer and channel adapters only responsible for transport.

**Public contracts:**

- Add `expenseCopies.expenseSavedConfirmation(input)` accepting `concept`, `amount`, `currency`, `sheetName`, and optional `rowIndex`.
- Preserve `ResolveExpenseSummaryActionUseCase.execute(input)` as the confirmation entry point while changing its successful-confirmation content.

- [x] Define the typed copy input and implement the successful confirmation format in `expense.copies.ts`, including concept, amount/currency, quoted sheet name, and `row N` only when a row is present.
- [x] Update `ResolveExpenseSummaryActionUseCase.handleConfirm()` to use the save result and the review payload when building the success copy.
- [x] Ensure that only the Application use case chooses success behavior and text; the webhook/worker must continue to deserialize, validate, and delegate without provider or messaging business logic.
- [x] Verify the final confirmation is sent only after `save()` resolves successfully, and preserve the existing immediate saving acknowledgement where appropriate.
- [x] Add copy and use-case tests covering complete metadata, multi-sheet metadata, and a confirmed save without a row number.
- [x] Update [expense confirmation documentation](../../../docs/features/expense-confirmation.md) and [its README index](../../../docs/features/README.md) with the implemented E1-US-10 confirmation contract and examples.
- [x] Run linting and typechecking through the local project binaries because the installed `pnpm` executable cannot open its database file. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 3: Protect the failure branch and regressions

Complete the reliability boundary around saving so a failed write cannot emit a successful confirmation, and verify the feature against the E1-US-12 alternative flow and existing confirmation entry points.

**Public contracts:**

- Add or extend Vitest contracts covering success confirmation dispatch and explicit absence of dispatch after a failed `save()`.
- No additional database, HTTP, or external messaging API contract is introduced.

- [ ] Map save exceptions and structured provider failures to the E1-US-12 failure/retry flow, preserving its FSM state and user-facing recovery behavior. Blocked: E1-US-12 currently exists only as a user-story document; its use case, retry state payload, and recovery copies have not been implemented.
- [x] Assert that a rejected or failed save never invokes the successful location-aware copy or sends a successful confirmation message.
- [x] Add regression coverage for callback and text confirmation paths, including their delegation through `ResolveExpenseReviewReplyUseCase` and workers where applicable.
- [x] Document the normal-condition ≤3-second verification as an operational acceptance check because the current test harness mocks spreadsheet and messaging boundaries.
- [x] Run the relevant Vitest suites and the full suite through the local project binary because the installed `pnpm` executable cannot open its database file. All tests pass outside the sandbox; bootstrap tests require a local listener.
- [ ] Reconcile the completed implementation with the E1-US-10 task files by checking only the acceptance criteria demonstrably satisfied. Deferred until the E1-US-12 integration task is completed.
- [x] Run linting and typechecking through the local project binaries because the installed `pnpm` executable cannot open its database file. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

# Next step

Implement E1-US-12, then complete the blocked failure-flow integration and reconcile the E1-US-10 task files.
