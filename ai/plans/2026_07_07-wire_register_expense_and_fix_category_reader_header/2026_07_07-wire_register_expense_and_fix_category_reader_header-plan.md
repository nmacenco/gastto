# Wire RegisterExpenseUseCase and fix category reader header skip

## Goal

Address two production issues raised in PR review comments: prevent the message worker from crashing when `registerExpense` is wired as `null`, and ensure category vocabulary read from a spreadsheet column excludes the header row.

## Context

- `src/interfaces/workers/message.worker.ts` calls `opts.registerExpense.interpret(...)` for `IDLE` / `EXPENSE_RECEIVING` (line 147) and `EXPENSE_CLARIFYING` (line 587), but `src/main.ts` passes `registerExpense: null` (line 436). The outer `try/catch` hides the null-dereference as a generic fallback error, so users in `IDLE` receive an unhelpful message and the job fails.
- `RegisterExpenseUseCase` already exists in `src/application/use-cases/expense/RegisterExpense.ts`, but it cannot be wired yet because `IExpenseRecordRepository` has no Drizzle implementation, even though the `expense_records` schema already exists in `src/infrastructure/db/schema/index.ts`.
- `SpreadsheetCategoryReader.ts` does not exist in the tree, and `SpreadsheetPort.getUniqueValues` is not implemented in `GoogleSheetsAdapter` or `ExcelOnlineAdapter` (both throw `SpreadsheetError('not yet implemented')`). The review comment notes that a whole-column read (e.g. `C:C`) would include the header text in the detected category vocabulary.
- HU-4.07 ("Confirmar las categorias de la planilla") describes the category-confirmation flow but has no feature doc or implementation yet.
- Relevant docs to consult during implementation:
  - `docs/plans/plan-conventions.md` (this plan format).
  - `docs/adr/adr.md` for ADR-003 (FSM), ADR-004 (spreadsheet adapters), ADR-005 (BullMQ worker), and ADR-006 (soft-delete/append semantics).
  - `docs/features/select-sheet.md` for `SpreadsheetPort` contract details.
  - `docs/user-stories/01-mvp/01-Vinculacion de planilla · Release 1 MVP/HU-4.07 — Confirmar las categorias de la planilla.md` for the category-confirmation acceptance criteria.

## Phases

### Phase 1: Safe fallback when `registerExpense` is not wired

Add a null guard in the message worker so users in `IDLE` / `EXPENSE_RECEIVING` and `EXPENSE_CLARIFYING` get a clear message instead of a null-dereference.

- [x] In `src/interfaces/workers/message.worker.ts`, check `opts.registerExpense` before calling `.interpret` in the `IDLE` / `EXPENSE_RECEIVING` branch.
- [x] Apply the same guard in the `EXPENSE_CLARIFYING` branch.
- [x] Add a new copy method in `src/application/copies/expense.copies.ts` (e.g. `expenseRegistrationUnavailable()`) with a friendly Spanish message.
- [x] Send that copy when `registerExpense` is null and stay in the current state (do not transition).
- [x] Add unit tests in `src/interfaces/workers/message.worker.spec.ts` covering:
  - `IDLE` with `registerExpense: null` sends the unavailable copy.
  - `EXPENSE_CLARIFYING` with `registerExpense: null` sends the unavailable copy.
- [x] Run `pnpm run lint` and `pnpm run typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Implement `DrizzleExpenseRecordRepository`

Create the missing repository so `RegisterExpenseUseCase` can be instantiated.

- [x] Create `src/infrastructure/db/repositories/DrizzleExpenseRecordRepository.ts` implementing `IExpenseRecordRepository` from `src/domain/ports/repositories.ts`.
- [x] Implement `create(record)` inserting into `expense_records` and returning the created entity.
- [x] Implement `findLatestByUserId(userId)` returning the most recent non-deleted record for the user.
- [x] Implement `softDelete(id)` setting `is_deleted = true` and `deleted_at = now()`.
- [x] Create `src/infrastructure/db/repositories/DrizzleExpenseRecordRepository.spec.ts` with mocked Drizzle tests for all three methods.
- [x] Run `pnpm run lint` and `pnpm run typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Wire `RegisterExpenseUseCase` in `main.ts`

Replace the `null` wiring with a real use-case instance.

- [x] Import `RegisterExpenseUseCase` and `DrizzleExpenseRecordRepository` in `src/main.ts`.
- [x] Instantiate `DrizzleExpenseRecordRepository` alongside the other Drizzle repositories.
- [x] Instantiate `RegisterExpenseUseCase` with:
  - `llmPort` (already created as `llmPort`),
  - a `SpreadsheetPort` instance (use `new GoogleSheetsAdapter('')` as a placeholder if the real per-user token factory is not wired yet, or wire the factory if available),
  - `expenseRepo`, `spreadsheetConfigRepo`, `columnMappingRepo`, `categoryRepo`, `conversationRepo`, and `operationLogRepo`.
- [x] Pass the instance to `createMessageWorker` as `registerExpense`.
- [x] Update `src/interfaces/workers/message.worker.spec.ts` so the default mock still works; add a test verifying `interpret` is invoked when a real use case is provided.
- [x] Run `pnpm run lint` and `pnpm run typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 4: Implement `SpreadsheetPort.getUniqueValues` with header skip

Implement the adapter method so whole-column reads do not return the header text.

- [x] Implement `getUniqueValues(fileId, columnIndex, sheetName)` in `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts`:
  - Build a range that starts at row 2 (e.g. `Sheet!C2:C`).
  - Fetch values, flatten, trim, filter empty strings, deduplicate preserving first-seen order.
- [x] Implement the same method in `src/infrastructure/adapters/sheets/ExcelOnlineAdapter.ts` with equivalent semantics.
- [x] Update `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.spec.ts` with tests for header skip and deduplication.
- [x] Update `src/infrastructure/adapters/sheets/ExcelOnlineAdapter.spec.ts` with equivalent tests.
- [x] Run `pnpm run lint` and `pnpm run typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 5: Implement `SpreadsheetCategoryReader`

Create the reader that produces a clean category vocabulary from the spreadsheet column.

- [x] Create `src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.ts`.
- [x] Define a public method (e.g. `readCategories(fileId, columnIndex, sheetName): Promise<string[]>`) that delegates to `SpreadsheetPort.getUniqueValues`, normalizes each value (trim, lowercase), removes empties, and returns deduplicated strings.
- [x] Accept `SpreadsheetPort` via constructor injection.
- [x] Create `src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.spec.ts` with tests for:
  - Header row is excluded.
  - Empty values are filtered.
  - Duplicates are collapsed.
  - Mixed-case values are normalized.
- [x] Run `pnpm run lint` and `pnpm run typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 6: Minimal category onboarding integration and docs

Give the reader a use site and document the feature.

- [x] In `src/interfaces/workers/message.worker.ts`, replace the `ONBOARDING_CATEGORIES` placeholder with a minimal handler:
  - If `SpreadsheetCategoryReader` is available, read categories from the configured category column.
  - If no categories are found, present the default set (Alimentacion, Transporte, Servicios, Ocio, Salud, Otros).
  - Send the list to the user with a confirmation prompt.
  - Transition to `ONBOARDING_CATEGORIES` with the detected/default categories stored in the state payload.
- [x] Add the necessary onboarding copies in `src/application/copies/onboarding.copies.ts`.
- [x] Add unit tests in `src/interfaces/workers/message.worker.spec.ts` for the `ONBOARDING_CATEGORIES` path.
- [x] Create `docs/features/category-confirmation.md` describing the flow, contracts, and error handling.
- [x] Update `docs/features/README.md` to link the new doc.
- [x] Run `pnpm run lint` and `pnpm run typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. Run the full verification suite (`pnpm lint && pnpm typecheck && pnpm test`) and commit the changes.
