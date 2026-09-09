# Subcategory Persistence, Compatibility, and Release

## Goal

Persist the linked category/subcategory selection only after a confirmed spreadsheet append, writing the optional subcategory cell only when it is mapped. Close the feature with retry, queue, undo, legacy-rollout, migration, documentation, integration, and end-to-end validation while preserving category-only behavior.

## Context

- [`src/application/use-cases/expense/RegisterExpense.ts`](../../../src/application/use-cases/expense/RegisterExpense.ts): Builds spreadsheet rows, appends them, creates the local expense record, records audit metadata, and exposes the immediate-undo identifier.
- [`src/domain/value-objects/expense-review-payload.ts`](../../../src/domain/value-objects/expense-review-payload.ts): Canonical reviewed expense with stable nullable category/subcategory IDs, names, statuses, and hierarchy capability.
- [`src/domain/value-objects/expense-save-retry-payload.ts`](../../../src/domain/value-objects/expense-save-retry-payload.ts): Persisted retry envelope whose nested review is normalized before replay.
- [`src/domain/entities/ExpenseRecord.ts`](../../../src/domain/entities/ExpenseRecord.ts): Saved-expense references and immutable category/subcategory text snapshots.
- [`src/domain/ports/repositories.ts`](../../../src/domain/ports/repositories.ts): Expense-record persistence contract used after the external append succeeds.
- [`src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts`](../../../src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts): Confirmation, save-failure classification, and retry-state creation from the reviewed payload.
- [`src/application/use-cases/expense/RetryExpenseSaveUseCase.ts`](../../../src/application/use-cases/expense/RetryExpenseSaveUseCase.ts): One user-initiated replay of the normalized reviewed expense without new NLP.
- [`src/application/use-cases/expense/QueuePendingExpense.ts`](../../../src/application/use-cases/expense/QueuePendingExpense.ts): FIFO admission of raw pending expense messages.
- [`src/application/use-cases/expense/AdvancePendingExpense.ts`](../../../src/application/use-cases/expense/AdvancePendingExpense.ts): Dequeues through normal interpretation and carries the resulting canonical review into confirmation and save.
- [`src/application/use-cases/expense/UndoLastExpense.ts`](../../../src/application/use-cases/expense/UndoLastExpense.ts): Deletes the exact persisted spreadsheet row and soft-deletes the matching local record independently of vocabulary state.
- [`src/infrastructure/db/repositories/DrizzleExpenseRecordRepository.ts`](../../../src/infrastructure/db/repositories/DrizzleExpenseRecordRepository.ts): Inserts and maps nullable hierarchy references plus immutable snapshots.
- [`src/infrastructure/db/schema/index.ts`](../../../src/infrastructure/db/schema/index.ts): Additive `expense_records` hierarchy columns, indexes, and `ON DELETE SET NULL` foreign keys.
- [`src/infrastructure/db/migrations/0007_material_eternals.sql`](../../../src/infrastructure/db/migrations/0007_material_eternals.sql): Generated additive hierarchy and expense-reference migration.
- [`src/infrastructure/db/migrations/0008_add_subcategory_mapping_field.sql`](../../../src/infrastructure/db/migrations/0008_add_subcategory_mapping_field.sql): Generated migration that permits the optional `subcategoria` mapping field.
- [`src/interfaces/workers/message.worker.ts`](../../../src/interfaces/workers/message.worker.ts): Confirmation, retry, queued-expense advancement, success messaging, and legacy payload routing.
- [`docs/adr/ADR-006-write-confirmation.md`](../../../docs/adr/ADR-006-write-confirmation.md): External-write confirmation, local persistence ordering, retry, and deterministic row-based undo decision.
- [`docs/adr/ADR-022-linked-subcategory-hierarchy.md`](../../../docs/adr/ADR-022-linked-subcategory-hierarchy.md): Stable parent/child references, immutable snapshots, nullable history, and no-backfill decision.
- [`docs/architecture/async-pipeline.md`](../../../docs/architecture/async-pipeline.md): Worker-owned persistence, retry, and messaging responsibilities.
- [`docs/architecture/data-model.md`](../../../docs/architecture/data-model.md): Canonical hierarchy tables, expense columns, indexes, foreign keys, and snapshot semantics.
- [`docs/architecture/module-contracts.md`](../../../docs/architecture/module-contracts.md): Clean Architecture dependency boundaries for application orchestration and Drizzle adapters.
- [`docs/features/expense-confirmation.md`](../../../docs/features/expense-confirmation.md): Existing confirmation, append, retry, queue, and negative failure guarantees.
- [`docs/features/category-confirmation.md`](../../../docs/features/category-confirmation.md): Category-only onboarding and vocabulary compatibility behavior.
- [`docs/features/subcategory-hierarchy.md`](../../../docs/features/subcategory-hierarchy.md): Implemented hierarchy activation, classification, correction, legacy normalization, and the persistence boundary this plan removes.
- [`docs/features/undo-last-expense.md`](../../../docs/features/undo-last-expense.md): Exact-row undo and local soft-delete behavior.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): Required save/cancel/undo coverage, call-order assertions, failure-path negatives, integration placement, and full ship gates.
- [`E1-US-18 - Classify and register linked subcategories`](../../../docs/user-stories/02-release-2-producto-complejo/01-epica-1/E1-US-18%20%E2%80%94%20Classify%20and%20register%20linked%20subcategories.md): Canonical save, retry, history, legacy, and end-to-end acceptance criteria.
- [`HU-4.08 - Configure linked categories and subcategories`](../../../docs/user-stories/02-release-2-producto-complejo/02-epica-4/HU-4.08%20%E2%80%94%20Configure%20linked%20categories%20and%20subcategories.md): Completed hierarchy configuration dependency and category-only compatibility contract.
- [`Subcategory Natural-Language Correction`](../2026_09_02-subcategory_natural_language_correction/2026_09_02-subcategory_natural_language_correction-plan.md): Completed prerequisite that canonicalizes hierarchy fields across review, correction, clarification, retry, queue progression, and worker boundaries.

### Public contracts activated or preserved

- `RegisterExpenseUseCase.save(userId, payload, spreadsheetId)`: continues to append first and create one local `ExpenseRecord` only after provider confirmation; it now consumes `resolvedCategoryId`, `resolvedSubcategoryId`, and `resolvedSubcategory` from the normalized review.
- Spreadsheet row construction: `subcategoria` is optional and receives the confirmed subcategory name or `null` only when a valid mapping exists; without that mapping, row shape and values remain unchanged.
- `ExpenseRecord`: `categoria` and `subcategoria` are immutable save-time snapshots, while `categoryId` and `subcategoryId` are nullable traceability references that may later be cleared by `ON DELETE SET NULL`.
- `ExpenseSaveRetryPayload`: retains the complete canonical reviewed expense, including hierarchy identifiers, snapshots, statuses, and capability, and replays it once without calling extraction or correction NLP.
- Pending-expense queue: remains a raw-message FIFO. A dequeued item is interpreted once through the normal registration path; after it reaches review, confirmation and retry reuse that canonical reviewed selection without reinterpreting it.
- `UndoLastExpenseUseCase`: continues to target the saved `{ spreadsheetId, sheetName, rowIndex }` and expense ID; vocabulary names, activation state, moves, and nullable references do not participate in row selection.
- Legacy rollout: missing hierarchy fields normalize to null/no-child defaults, and users without a mapped subcategory column or configured active children retain the existing category-only behavior.

## Phases

### Phase 1: Activate hierarchy-aware save persistence

#### Description

Consume the canonical reviewed selection at the existing save boundary. Add the optional spreadsheet value without changing unmapped row layouts, then persist matching stable references and text snapshots only after the external provider confirms the append.

#### To-do actions

- [x] Extend `RegisterExpenseUseCase.buildRow()` with an explicit `subcategoria` mapping branch that writes `payload.resolvedSubcategory` or `null` at the configured index and never adds or shifts a column when no such mapping exists.
- [x] Keep existing mapping validation, sparse-index handling, cell sanitization in the spreadsheet adapter, date/amount/currency formatting, and provider error classification unchanged.
- [x] Update `RegisterExpenseUseCase.save()` so the local record uses `resolvedCategoryId`, `resolvedSubcategoryId`, `resolvedCategory`, and `resolvedSubcategory` from the canonical reviewed payload instead of hard-coded null hierarchy fields.
- [x] Preserve category-only and unresolved selections as nullable references/snapshots; never derive an identifier from display text and never infer a child from the parent or mapping capability.
- [x] Retain the strict side-effect order: build row, await the provider-confirmed append, create exactly one local expense record, write the success audit, transition to `IDLE` with the immediate-undo ID, and only then allow the existing success presentation path to run.
- [x] Extend `RegisterExpense.spec.ts` with mapped-child, mapped-no-child, unmapped-child, configured-hierarchy-without-mapping, category-only, and legacy-normalized saves; assert exact row arrays and exact local identifier/snapshot inputs.
- [x] Add explicit `RegisterExpense.spec.ts` negatives for network, authorization, structure, and malformed-mapping failures proving `expenseRepo.create`, success audit, `IDLE` transition, and success confirmation eligibility never occur before or after a failed append.
- [x] Extend `DrizzleExpenseRecordRepository.spec.ts` with save-boundary fixtures that round-trip populated and nullable hierarchy references/snapshots without rewriting display text.
- [x] Run the focused `RegisterExpenseUseCase` and `DrizzleExpenseRecordRepository` unit suites.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Preserve retry, queue, worker, and undo guarantees

#### Description

Exercise the hierarchy-aware save through every asynchronous continuation. Retried reviewed expenses must preserve the same selection without NLP, queued raw expenses must enter the canonical flow once dequeued, and undo must remain bound solely to the confirmed spreadsheet row.

#### To-do actions

- [x] Extend `ResolveExpenseSummaryActionUseCase.spec.ts` to prove retryable append failures store the complete canonical category/subcategory review unchanged, send no success confirmation, and leave local expense persistence empty.
- [x] Extend `RetryExpenseSaveUseCase.spec.ts` with selected-child, valid-no-child, and legacy retry payloads; assert the replay passes normalized reviewed data to `registerExpense.save()` exactly once and invokes no extraction, classification, or correction NLP.
- [x] Verify a successful hierarchy retry persists and confirms once, while a second failure persists no local expense, clears retry state according to the existing policy, and sends only the manual-copy fallback.
- [x] Extend `QueuePendingExpense.spec.ts` and `AdvancePendingExpense.spec.ts` to keep queue storage raw and FIFO, interpret a dequeued item once, preserve the resulting canonical hierarchy review through confirmation, and retain queue items when interpretation or presentation fails.
- [x] Extend `message.worker.spec.ts` for text and callback confirmations, retry commands, queued-batch progression, final batch copy, expired/malformed legacy retry recovery, and hierarchy-disabled users; assert no duplicate presentation, append, NLP, or success message.
- [x] Extend `UndoLastExpense.spec.ts` and expense-repository tests with saved hierarchy records whose vocabulary rows are renamed, moved, soft-disabled, or hard-deleted; assert the same sheet and row are targeted and snapshots do not influence lookup or deletion.
- [x] Preserve immediate and delayed undo identity checks, spreadsheet-first deletion, transactional local soft-delete/audit, and failure behavior without adding category/subcategory repository dependencies to undo.
- [x] Run the focused summary-action, retry, queue, pending-advance, worker, undo, and expense-repository suites.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Validate compatibility and complete the release contract

#### Description

Prove the production migration chain and end-to-end behavior for mapped, unmapped, and legacy users, synchronize canonical documentation, and close the linked-subcategory stories only after every ship gate passes.

#### To-do actions

- [ ] Extend `DrizzleExpenseRecordRepository.integration.spec.ts` and `subcategory-hierarchy-persistence.integration.spec.ts` to save through the real schema with populated and null references, preserve snapshots after vocabulary rename/deactivation/deletion, and verify existing rows remain null without any inferred backfill.
- [ ] Run the full generated migration chain, including `0007_material_eternals.sql` and `0008_add_subcategory_mapping_field.sql`, against a fresh PostgreSQL Testcontainer and verify every hierarchy table, optional mapping constraint, index, foreign key action, and legacy expense remains compatible; do not edit or reorder existing migrations.
- [ ] Add an end-to-end worker-level scenario under `src/__tests__/e2e/` for a mapped hierarchy: classify or load a canonical reviewed parent/child selection, confirm it, append the child in the mapped column, persist matching IDs and snapshots, send one success confirmation, and undo the exact returned row.
- [ ] Add the corresponding end-to-end scenarios for a mapped category with no child, an unmapped category-only spreadsheet, configured children without a mapping, and a legacy review payload; assert unchanged spreadsheet shape whenever `subcategoria` is unmapped.
- [ ] Add end-to-end failure scenarios for first append failure, successful user-initiated retry, and second retry failure, with mandatory negatives proving no failed append creates a local expense, changes undo state, or sends a success confirmation.
- [ ] Verify automatic rollout in tests: hierarchy presentation/classification remains enabled only by a confirmed `subcategoria` mapping or active configured children, while external child writing requires the mapping specifically and legacy users retain current output and persistence behavior.
- [ ] Update `docs/features/subcategory-hierarchy.md` to replace the deferred persistence boundary with implemented spreadsheet, local record, retry, queue, undo, history, and rollout behavior plus final QA cases.
- [ ] Update `docs/features/expense-confirmation.md` with optional child-column writes, stable local references/snapshots, preserved retry data, and explicit append-failure negative guarantees.
- [ ] Update `docs/features/category-confirmation.md` only where needed to link confirmed hierarchy capability and preserve the category-only contract; synchronize every changed or added feature entry in `docs/features/README.md`.
- [ ] Update `docs/architecture/data-model.md` with the final runtime write/read lifecycle, null legacy history, immutable snapshots, and no-backfill behavior; verify ADR-006 and ADR-022 references remain accurate and synchronize `docs/adr/README.md` only if an ADR document changes.
- [ ] Check every satisfied Definition of Done item in `E1-US-18`; re-verify `HU-4.08` remains complete and do not close any criterion that lacks passing evidence.
- [ ] Run the focused repository, save, retry, queue, worker, undo, migration integration, and end-to-end suites for spreadsheets with and without hierarchy support.
- [ ] Run `pnpm test` to execute the complete project test suite after focused suites pass.
- [ ] Run `pnpm run format:check` to verify source, tests, migration metadata, feature documentation, story updates, and indexes follow repository formatting.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Implement Phase 3 to validate compatibility and complete the release contract.
