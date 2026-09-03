# Subcategory Data and Domain Foundation

## Goal

Add the storage, domain, and repository foundation for linked subcategories without enabling subcategory detection, classification, correction, presentation, or spreadsheet writes. The foundation must be additive, preserve stable identifiers and historical text snapshots, and remain compatible with existing category-only users and expense records.

## Context

- [`src/infrastructure/db/schema/index.ts`](../../../src/infrastructure/db/schema/index.ts): Current `user_categories` and `expense_records` Drizzle definitions, foreign keys, constraints, and indexes.
- [`drizzle.config.ts`](../../../drizzle.config.ts): Schema-first migration configuration; generated migrations belong under `src/infrastructure/db/migrations/`.
- [`src/domain/entities/Category.ts`](../../../src/domain/entities/Category.ts): Stable category identifier and normalized-name contract used by the aggregate.
- [`src/domain/entities/CategoryVocabulary.ts`](../../../src/domain/entities/CategoryVocabulary.ts): Current flat aggregate and category add, rename, and remove invariants.
- [`src/domain/entities/SpreadsheetConfig.ts`](../../../src/domain/entities/SpreadsheetConfig.ts): Current row-level `UserCategory` persistence shape.
- [`src/domain/entities/ExpenseRecord.ts`](../../../src/domain/entities/ExpenseRecord.ts): Current saved-expense entity and retained category snapshot.
- [`src/domain/ports/repositories.ts`](../../../src/domain/ports/repositories.ts): Row-level category, aggregate vocabulary, and expense repository ports.
- [`src/infrastructure/db/repositories/DrizzleUserCategoryRepository.ts`](../../../src/infrastructure/db/repositories/DrizzleUserCategoryRepository.ts): Row-level active category lookup, upsert, usage increment, and row mapping.
- [`src/infrastructure/db/repositories/DrizzleCategoryVocabularyRepository.ts`](../../../src/infrastructure/db/repositories/DrizzleCategoryVocabularyRepository.ts): Aggregate loading and transactional category persistence that must be extended to the complete hierarchy.
- [`src/infrastructure/db/repositories/DrizzleExpenseRecordRepository.ts`](../../../src/infrastructure/db/repositories/DrizzleExpenseRecordRepository.ts): Expense insert and row-to-domain mapping that must carry the new nullable fields.
- [`src/application/use-cases/expense/RegisterExpense.ts`](../../../src/application/use-cases/expense/RegisterExpense.ts): Existing record creation call site; this subplan supplies null hierarchy references so runtime classification and spreadsheet behavior remain unchanged.
- [`docs/adr/ADR-001-modular-monolith.md`](../../../docs/adr/ADR-001-modular-monolith.md): Clean Architecture and modular-boundary decision governing domain ports and Drizzle adapters.
- [`docs/adr/ADR-006-write-confirmation.md`](../../../docs/adr/ADR-006-write-confirmation.md): Existing rule that local expense persistence happens only after a successful spreadsheet append.
- [`docs/templates/adr.md`](../../../docs/templates/adr.md): Required structure for the new hierarchy and snapshot/reference ADR.
- [`docs/architecture/data-model.md`](../../../docs/architecture/data-model.md): Canonical tables, indexes, foreign keys, aggregates, and data-design documentation.
- [`docs/features/category-confirmation.md`](../../../docs/features/category-confirmation.md): Existing category vocabulary behavior and soft-disable semantics that this foundation must preserve.
- [`docs/features/expense-correction.md`](../../../docs/features/expense-correction.md): Existing review-state and delayed-persistence boundary; this subplan does not change correction behavior.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): Domain, repository, PostgreSQL integration, failure-path, and full-suite expectations.
- [`HU-4.08 - Configure linked categories and subcategories`](../../../docs/user-stories/02-release-2-producto-complejo/02-epica-4/HU-4.08%20%E2%80%94%20Configure%20linked%20categories%20and%20subcategories.md): Parent-scoped hierarchy, duplicate, mutation, soft-disable, and atomic-save contract.
- [`E1-US-18 - Classify and register linked subcategories`](../../../docs/user-stories/02-release-2-producto-complejo/01-epica-1/E1-US-18%20%E2%80%94%20Classify%20and%20register%20linked%20subcategories.md): Nullable references, immutable snapshots, deletion behavior, and legacy-expense compatibility contract.

### Public contracts introduced or extended

- `Subcategory`: `{ id: string; categoryId: string; name: string; normalizedName: string }`.
- `UserSubcategory`: `{ id: string; categoryId: string; rawValue: string; normalizedValue: string; usageCount: number; isActive: boolean; createdAt: Date }`.
- `CategoryVocabulary` constructor: accepts the spreadsheet ID, categories, and subcategories while keeping empty arrays as defaults for existing callers.
- `CategoryVocabulary.getSubcategories(categoryId?)`: returns all children or only those belonging to one parent without exposing mutable aggregate state.
- `CategoryVocabulary.findSubcategory(categoryId, name)`: performs an exact normalized lookup scoped to one parent.
- `CategoryVocabulary.addSubcategory(categoryId, name)`: requires an existing parent, rejects an empty name and a normalized duplicate under that parent, permits the same normalized name under another parent, and returns a child with a generated UUID.
- `CategoryVocabulary.renameSubcategory(id, newName)`: preserves the child ID and parent, validates the target name, and enforces uniqueness only within that parent.
- `CategoryVocabulary.moveSubcategory(id, targetCategoryId)`: requires both the child and target parent, preserves the child ID and name, rejects a duplicate under the target, and removes the relationship from the former parent atomically in memory.
- `CategoryVocabulary.removeSubcategory(id)`: removes only the selected child from the active aggregate; repository persistence soft-disables the row.
- `CategoryVocabulary.removeCategory(id)`: continues removing the category and also removes its children from the active aggregate so one transactional save soft-disables the complete branch.
- `IUserSubcategoryRepository`: row-level `findActiveByCategoryId`, `upsertMany`, and `incrementUsage` operations parallel to the existing category repository and retain stable supplied IDs for newly inserted rows.
- `IUserCategoryRepository.upsertMany`: accepts caller-supplied IDs for new category rows instead of discarding domain-generated identifiers.
- `ICategoryVocabularyRepository.findBySpreadsheetId` and `save`: retain their signatures but load and persist the complete category/subcategory aggregate in one transaction.
- `ExpenseRecord`: adds required-but-nullable `categoryId`, `subcategoryId`, and `subcategoria` properties; `categoria` remains the immutable category text snapshot.
- `IExpenseRecordRepository.create`: retains its method shape while its input carries the three new nullable `ExpenseRecord` properties.

## Phases

### Phase 1: Add the deployable hierarchy schema and architecture decision

#### Description

Create an additive database migration and its canonical documentation before any repository consumes the new columns. Prove that legacy rows remain valid and that hard-deletion semantics preserve expense snapshots while clearing vocabulary references.

#### To-do actions

- [x] Create `docs/adr/ADR-022-linked-subcategory-hierarchy.md` from `docs/templates/adr.md`, recording the separate child table, required parent, parent-scoped uniqueness, soft-disable lifecycle, nullable expense references, immutable category/subcategory snapshots, no historical backfill, and rollout before consumers.
- [x] Add ADR-022 to `docs/adr/README.md` in sequence with status and title synchronized to the ADR.
- [x] Define `userSubcategories` in `src/infrastructure/db/schema/index.ts` with `id` as a UUID primary key with `defaultRandom()`, required `categoryId`, required raw and normalized values, `usageCount` defaulting to zero, `isActive` defaulting to true, and `createdAt` defaulting to the current timestamp.
- [x] Declare the `category_id` foreign key to `user_categories.id` with `ON DELETE CASCADE`, a parent lookup index suitable for active-child queries, and a unique index on `(category_id, normalized_value)` so the same normalized child is allowed under different parents but not twice under one parent.
- [x] Extend `expenseRecords` with nullable `categoryId`, `subcategoryId`, and `subcategoria`; point the two identifiers to `user_categories.id` and `user_subcategories.id` with explicit `ON DELETE SET NULL` actions.
- [x] Add explicit `expense_records.category_id` and `expense_records.subcategory_id` indexes for historical/reference lookups while retaining the existing nullable `categoria` snapshot unchanged.
- [x] Run `pnpm db:generate` after the schema change and retain only the newly generated SQL, snapshot, and journal changes under `src/infrastructure/db/migrations/`; inspect the generated SQL for additive DDL and do not edit, delete, or reorder any existing migration.
- [x] Update `docs/architecture/data-model.md` with the new table, expense columns, entity graph, full/partial indexes, foreign-key actions, snapshot/reference rationale, nullable legacy behavior, and the increase in the documented table count.
- [x] Add `src/__tests__/integration/subcategory-hierarchy-persistence.integration.spec.ts` using PostgreSQL/Testcontainers and the real migration chain to verify a legacy expense can still be inserted with null hierarchy fields, same-parent duplicates fail, the same normalized child under different parents succeeds, invalid parents fail, and deleting a category cascades configured children while setting both expense references to null and preserving both text snapshots.
- [x] Run the focused PostgreSQL integration test with `RUN_POSTGRES_INTEGRATION=true pnpm exec vitest run src/__tests__/integration/subcategory-hierarchy-persistence.integration.spec.ts`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Implement the hierarchy aggregate and transactional repositories

#### Description

Introduce parent-aware domain behavior and persistence ports, then load and save categories plus subcategories as one consistent aggregate without wiring hierarchy behavior into onboarding or classification.

#### To-do actions

- [ ] Add `src/domain/entities/Subcategory.ts` with the stable identifier, required parent category identifier, raw display name, and normalized name contract.
- [ ] Add `UserSubcategory` to `src/domain/entities/SpreadsheetConfig.ts` as the row-level persistence entity mirroring `user_subcategories`.
- [ ] Extend `CategoryVocabulary` with backward-compatible constructor defaults and the public lookup, add, rename, move, and remove methods defined above.
- [ ] Enforce pure domain invariants: reject blank normalized names, reject missing child or parent identifiers, scope duplicate detection to a parent, permit equal child names under different parents, preserve IDs on rename and move, and remove all active children when their category is removed.
- [ ] Extend `src/domain/entities/CategoryVocabulary.spec.ts` with meaningful assertions for construction, immutable reads, lookup isolation, generated IDs, blank and duplicate rejection, same-name children under different parents, rename isolation, move success and collision rejection, individual child removal, and category-branch removal.
- [ ] Add `IUserSubcategoryRepository` to `src/domain/ports/repositories.ts`, change category and subcategory `upsertMany` inputs to retain supplied IDs while omitting only database-generated timestamps, and keep infrastructure types out of the domain port.
- [ ] Add `src/infrastructure/db/repositories/DrizzleUserSubcategoryRepository.ts` with active lookup by parent, ID-preserving upsert/reactivation on `(category_id, normalized_value)`, usage-count increment, and row-to-domain mapping.
- [ ] Update `DrizzleUserCategoryRepository` so genuinely new rows use the supplied category ID; on conflicts, preserve the already persisted primary key and update only mutable raw/active fields.
- [ ] Extend `DrizzleCategoryVocabularyRepository.findBySpreadsheetId` to load active categories and only their active children, return a hierarchy with persisted stable IDs, avoid exposing orphan rows, and preserve the current `null` result when no active category exists.
- [ ] Extend `DrizzleCategoryVocabularyRepository.save` so category and child reads, soft-disables, inserts, reactivations, renames, and moves occur within one `db.transaction`; persist parents before children, resolve existing IDs during reactivation, never rewrite primary keys on conflict, and roll back the complete hierarchy if any child mutation fails.
- [ ] Ensure all category and subcategory inserts pass the aggregate-generated `id` explicitly, while natural-key conflicts keep the existing database ID; use the resolved persisted parent ID when saving a reactivated branch so no dangling child reference can be produced.
- [ ] Add `DrizzleUserCategoryRepository.spec.ts` and `DrizzleUserSubcategoryRepository.spec.ts`, and extend `DrizzleCategoryVocabularyRepository.spec.ts` for active filtering, parent isolation, row mapping, supplied-ID insertion, persisted-ID reactivation, usage increments, complete hierarchy loading, soft-disable behavior, transaction boundaries, operation order, and rollback propagation.
- [ ] Extend the PostgreSQL hierarchy integration test to prove aggregate round-trips preserve IDs, saving the same aggregate is idempotent, moving a child changes only its parent, removed entries become inactive, removing a category disables its children, and an induced child failure leaves categories and subcategories unchanged.
- [ ] Update the `CategoryVocabulary` aggregate section in `docs/architecture/data-model.md` with the parent-scoped invariants, stable-ID behavior, soft-disable semantics, and transactional persistence boundary.
- [ ] Run focused tests for `CategoryVocabulary`, `DrizzleUserSubcategoryRepository`, `DrizzleCategoryVocabularyRepository`, and the PostgreSQL hierarchy integration suite.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Carry nullable hierarchy references through saved expenses

#### Description

Complete the inactive foundation by extending saved-expense entities and persistence mapping. Existing runtime callers explicitly write null hierarchy values until later subplans provide classified identifiers and a subcategory snapshot.

#### To-do actions

- [ ] Extend `ExpenseRecord` with `categoryId: string | null`, `subcategoryId: string | null`, and `subcategoria: string | null`, retaining `categoria` as the historical category text snapshot and making no change to `ExtractedExpense` in this subplan.
- [ ] Update `DrizzleExpenseRecordRepository.create` to insert both nullable identifiers and the subcategory snapshot, and update `mapExpenseRecord` so create, latest-expense, average/currency queries, and undo paths return the extended entity without changing their selection semantics.
- [ ] Update the current `RegisterExpenseUseCase.save` call to pass `categoryId: null`, `subcategoryId: null`, and `subcategoria: null`; do not alter classification, review payloads, spreadsheet row construction, retry payloads, messages, or the write-before-local-persistence order from ADR-006.
- [ ] Update expense fixtures and typed mocks affected by the required nullable fields so legacy/category-only paths remain explicit and type-safe.
- [ ] Extend `DrizzleExpenseRecordRepository.spec.ts` to assert all three fields are inserted and mapped for populated and null cases, while retaining failure and undo coverage.
- [ ] Extend `DrizzleExpenseRecordRepository.integration.spec.ts` to persist and reload category/subcategory IDs plus both snapshots and to verify category or subcategory deletion clears only the matching references, never the stored `categoria` or `subcategoria` text.
- [ ] Run focused tests for `RegisterExpenseUseCase`, `DrizzleExpenseRecordRepository`, and the PostgreSQL expense/hierarchy integration suites.
- [ ] Run `pnpm test` to execute the complete project test suite after all focused tests pass.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Implement Phase 2 by adding the hierarchy aggregate, row-level subcategory repository, and transactional aggregate persistence.
