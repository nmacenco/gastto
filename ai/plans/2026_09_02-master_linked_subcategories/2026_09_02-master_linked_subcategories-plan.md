# Master Plan: Linked Subcategory Hierarchy

## Goal

Deliver linked subcategories through seven independently reviewable subplans. Each subplan must leave the application buildable, tested, and backward-compatible before the next one begins.

## Context

- [`src/domain/entities/CategoryVocabulary.ts`](../../../src/domain/entities/CategoryVocabulary.ts): Current flat category aggregate.
- [`src/domain/entities/SpreadsheetConfig.ts`](../../../src/domain/entities/SpreadsheetConfig.ts): Current canonical spreadsheet fields and category row type.
- [`src/application/use-cases/expense/ClassifyExpenseCategory.ts`](../../../src/application/use-cases/expense/ClassifyExpenseCategory.ts): Current name-only category classification.
- [`src/application/use-cases/expense/RegisterExpense.ts`](../../../src/application/use-cases/expense/RegisterExpense.ts): Expense interpretation, review payload, spreadsheet row, and persistence flow.
- [`src/application/use-cases/spreadsheet/DetectCategories.ts`](../../../src/application/use-cases/spreadsheet/DetectCategories.ts): Current single-column category detection.
- [`src/application/use-cases/spreadsheet/ModifyCategoryVocabulary.ts`](../../../src/application/use-cases/spreadsheet/ModifyCategoryVocabulary.ts): Current flat vocabulary modifications.
- [`src/infrastructure/db/schema/index.ts`](../../../src/infrastructure/db/schema/index.ts): `column_mappings`, `user_categories`, and `expense_records` schemas.
- [`docs/features/category-confirmation.md`](../../../docs/features/category-confirmation.md): Canonical category onboarding behavior.
- [`docs/features/expense-correction.md`](../../../docs/features/expense-correction.md): Correction and persisted review-state contracts.
- [`docs/architecture/data-model.md`](../../../docs/architecture/data-model.md): Canonical database model.
- [`docs/adr/adr.md`](../../../docs/adr/adr.md): Architecture decisions governing LLM extraction and spreadsheet adapters.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): Required unit, integration, FSM, and failure-path coverage.

### Approved contracts and defaults

- Register two Release 2 stories: `HU-4.08` for configuring the hierarchy and `E1-US-18` for classifying, reviewing, correcting, and saving linked subcategories.
- Store subcategories in a separate `user_subcategories` table with a required parent category.
- Allow the same normalized subcategory name under different parents, but reject duplicates under the same parent.
- Add nullable category and subcategory references plus a subcategory text snapshot to expense records. Retain the existing category text snapshot for historical stability.
- Use `ON DELETE CASCADE` from categories to configured subcategories and `ON DELETE SET NULL` from expense references to vocabulary rows.
- Add `subcategoria` as an optional spreadsheet field. Existing spreadsheets without that column retain current behavior.
- Classify the parent category first, then search only its active subcategories.
- Permit a category without a subcategory.
- Exclude spreadsheet rows containing a subcategory without a parent category and report those values to the user.
- Accept existing JSONB conversation payloads without subcategory fields as legacy payloads with no subcategory.
- Do not perform fuzzy or destructive historical backfills.
- Add no HTTP routes or FSM states.

## Phases

### Phase 1: Create the Release 2 user stories

#### Description

Create the backlog contracts before implementation. This documentation-only delivery defines the complete behavior, acceptance criteria, dependencies, and boundaries for both affected epics.

#### To-do actions

- [x] Create `ai/plans/2026_09_02-create_linked_subcategory_user_stories/2026_09_02-create_linked_subcategory_user_stories-plan.md` as the detailed execution plan for this phase.
- [x] Create `HU-4.08` under the spreadsheet-linking epic for detecting, managing, and confirming category/subcategory relationships.
- [x] Cover the optional subcategory column, row-pair preservation, empty hierarchies, orphan reporting, duplicate rules, and parent-aware add, rename, move, and remove commands.
- [x] Create `E1-US-18` under the expense-registration epic for classifying, reviewing, correcting, saving, retrying, and auditing a linked subcategory.
- [x] Define `HU-4.08` as a dependency of `E1-US-18` and retain dependencies on the existing category, review, correction, and confirmation stories.
- [x] Assign both stories to Release 2 with 8 story points each.
- [x] Update the consolidated Epic 4 and Epic 1 story documents and summary tables.
- [x] Resolve the stale `E1-US-13` summary description without renumbering existing story directories.
- [x] Verify that both stories use Gherkin scenarios and testable Definitions of Done.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Create the additive data and domain foundation subplan

#### Description

Plan an additive hierarchy and stable identifiers without activating new runtime behavior. The resulting implementation must be deployable before any consumer starts using subcategories.

#### To-do actions

- [x] Create `ai/plans/2026_09_02-subcategory_data_domain_foundation/2026_09_02-subcategory_data_domain_foundation-plan.md`.
- [x] Specify `user_subcategories` with `id`, `category_id`, raw and normalized values, usage count, active flag, creation timestamp, FK, lookup index, and `(category_id, normalized_value)` uniqueness.
- [x] Specify nullable `category_id`, `subcategory_id`, and `subcategoria` columns for `expense_records`, including indexes and `ON DELETE SET NULL` behavior.
- [x] Require schema-first Drizzle changes and a generated additive migration without editing existing migrations.
- [x] Define the `Subcategory` entity and parent-scoped add, rename, move, remove, lookup, and duplicate invariants in `CategoryVocabulary`.
- [x] Preserve domain-generated category and subcategory IDs when repositories insert new rows.
- [x] Define row-level and aggregate repository contracts for loading and saving the hierarchy transactionally.
- [x] Extend `ExpenseRecord` with nullable identifiers and the subcategory snapshot while retaining current category behavior.
- [x] Specify domain, repository, schema, and integration tests for hierarchy integrity, duplicate scope, soft-disable behavior, and deletion semantics.
- [x] Require a new ADR for the hierarchy and snapshot/reference strategy, plus updates to `docs/adr/README.md` and `docs/architecture/data-model.md`.
- [x] Require focused tests and then the complete project test suite in the subplan.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Create the spreadsheet mapping and pair-detection subplan

#### Description

Plan recognition of an optional subcategory column and safe extraction of parent/subcategory pairs without changing expense saving.

#### To-do actions

- [ ] Create `ai/plans/2026_09_02-subcategory_spreadsheet_mapping_detection/2026_09_02-subcategory_spreadsheet_mapping_detection-plan.md`.
- [ ] Add `subcategoria` to the planned `GasttoField` contract and database field constraint.
- [ ] Keep `subcategoria` optional so its absence never blocks existing mapping confirmation.
- [ ] Extend rule-based and LLM column inference, header vocabulary, mapping correction parsing, and proposal copies.
- [ ] Define a hierarchy reader contract that uses `SpreadsheetPort.readRows()` to preserve row-level parent/child relationships.
- [ ] Normalize and deduplicate pairs while allowing the same child name under different parents.
- [ ] Return orphan subcategories separately instead of assigning an invented parent.
- [ ] Cover Google Sheets and Excel Online through their existing `readRows()` implementations.
- [ ] Specify tests for mapped and unmapped optional columns, duplicate pairs, blank children, same-name children under different parents, and orphan rows.
- [ ] Require updates to the column-mapping feature documentation and `docs/features/README.md`.
- [ ] Require focused adapter tests and then the complete project test suite in the subplan.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 4: Create the onboarding management and confirmation subplan

#### Description

Plan the user-visible hierarchy configuration flow while reusing the existing `ONBOARDING_CATEGORIES` state.

#### To-do actions

- [ ] Create `ai/plans/2026_09_02-subcategory_onboarding_management/2026_09_02-subcategory_onboarding_management-plan.md`.
- [ ] Extend `DetectCategories` to load mapped pairs, persist the hierarchy, and retain flat behavior when no subcategory column exists.
- [ ] Define a typed hierarchical onboarding DTO while accepting legacy `categories: string[]` state payloads.
- [ ] Present categories with nested subcategories and warn about excluded orphan values.
- [ ] Extend category modification intents with parent-aware add, rename, move, and remove operations.
- [ ] Require an existing active parent for every subcategory mutation and reject ambiguous parent names.
- [ ] Confirm the complete hierarchy atomically before activating or reactivating the user.
- [ ] Preserve reconnection, interrupted onboarding, and idempotent re-confirmation behavior without adding an FSM state.
- [ ] Specify application, parser, worker, copy, persistence, and legacy-payload tests.
- [ ] Require creation of `docs/features/subcategory-hierarchy.md`, updates to category confirmation documentation, and synchronization of `docs/features/README.md`.
- [ ] Require focused onboarding tests and then the complete project test suite in the subplan.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 5: Create the hierarchical classification and review subplan

#### Description

Plan classification of a linked subcategory and presentation of the result during expense review without saving it externally yet.

#### To-do actions

- [ ] Create `ai/plans/2026_09_02-subcategory_classification_and_review/2026_09_02-subcategory_classification_and_review-plan.md`.
- [ ] Extend `ExtractedExpense` with nullable `subcategoriaRaw` and independent subcategory confidence.
- [ ] Pass hierarchical category context through `LLMPort` and update the OpenAI, Claude, and NVIDIA extraction schemas and prompts.
- [ ] Replace name-only classification results with a structured selection containing stable category and optional subcategory IDs, names, and statuses.
- [ ] Resolve the parent first and restrict exact, keyword, and fallback child matching to that parent.
- [ ] Return no subcategory when the parent is unresolved or no valid child matches.
- [ ] Extend `ExpenseReviewPayload` with backward-compatible subcategory fields and a `subcategoryEnabled` flag.
- [ ] Extend the expense summary and Telegram presenter to show subcategory data only when the feature is enabled for the user.
- [ ] Preserve current summary output for users without a subcategory mapping or configured hierarchy.
- [ ] Specify classifier, LLM adapter, review-payload, summary, presenter, and worker tests covering confidence and parent isolation.
- [ ] Require updates to the expense-summary and hierarchy feature documentation.
- [ ] Require focused classification and presentation tests and then the complete project test suite in the subplan.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 6: Create the natural-language correction subplan

#### Description

Plan atomic category/subcategory corrections while preserving persisted-state, retry, and queue compatibility.

#### To-do actions

- [ ] Create `ai/plans/2026_09_02-subcategory_natural_language_correction/2026_09_02-subcategory_natural_language_correction-plan.md`.
- [ ] Add `subcategoria` to correction field contracts and every provider correction schema and contextual prompt.
- [ ] Resolve category and subcategory together when both are corrected in one message.
- [ ] Clear the previous subcategory when a category correction changes the parent and no valid replacement is supplied.
- [ ] Reject a subcategory that does not belong to the selected parent and return a typed outcome containing the allowed children.
- [ ] Add user-facing correction guidance without mutating the stored review after rejection.
- [ ] Make correction, clarification, retry, queue, and worker validators accept missing legacy subcategory fields and normalize them to null/default status.
- [ ] Preserve correction-cycle limits, timeout behavior, high-amount checks, confirmation precedence, and queue admission rules.
- [ ] Specify correction, provider, serialization, legacy JSONB, queue regression, and worker presentation tests.
- [ ] Require updates to expense-correction and hierarchy feature documentation.
- [ ] Require focused correction and state tests and then the complete project test suite in the subplan.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 7: Create the persistence, compatibility, and release subplan

#### Description

Plan spreadsheet and internal persistence, then close the feature with backward-compatible integration and release validation.

#### To-do actions

- [ ] Create `ai/plans/2026_09_02-subcategory_persistence_and_release/2026_09_02-subcategory_persistence_and_release-plan.md`.
- [ ] Populate stable category and subcategory identifiers in all newly created review payloads.
- [ ] Write a subcategory value only when a valid `subcategoria` column mapping exists.
- [ ] Persist category/subcategory IDs and text snapshots only after the spreadsheet append succeeds.
- [ ] Carry the new fields through save retry and pending-expense flows without replaying NLP.
- [ ] Verify that undo remains based on the spreadsheet row and is independent of vocabulary renames or soft-disables.
- [ ] Keep historical identifiers nullable and perform no fuzzy or destructive backfill.
- [ ] Specify repository, save, retry, queue, undo, migration, integration, and end-to-end scenarios for spreadsheets with and without subcategory support.
- [ ] Require negative assertions proving that append failures persist no local expense and send no success confirmation.
- [ ] Complete the hierarchy feature documentation and synchronize expense confirmation, category confirmation, data model, ADR references, and documentation indexes.
- [ ] Verify automatic rollout: legacy users retain current behavior and hierarchy behavior activates only from a mapped column or configured subcategories.
- [ ] Require `pnpm test`, `pnpm run format:check`, migration integration checks, and all project ship gates in the subplan.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Create the Phase 3 spreadsheet mapping and pair-detection subplan before making any application-code changes.
