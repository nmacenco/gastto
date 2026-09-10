# Create Linked Subcategory User Stories

## Goal

Define the Release 2 backlog contracts for configuring linked category/subcategory hierarchies and using them throughout expense registration. Keep the contracts backward-compatible with spreadsheets and persisted conversation payloads that do not contain subcategories.

## Context

- [`docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.07-confirm-spreadsheet-categories/HU-4.07 — Confirm spreadsheet categories.md`](../../../docs/user-stories/01-mvp/01-Vinculación%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.07-confirm-spreadsheet-categories/HU-4.07%20%E2%80%94%20Confirm%20spreadsheet%20categories.md): Existing category-detection and confirmation contract.
- [`docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/Epica 4 - historias de usuario en un solo archivo.md`](../../../docs/user-stories/01-mvp/01-Vinculación%20de%20planilla%20%C2%B7%20Release%201%20MVP/Epica%204%20-%20historias%20de%20usuario%20en%20un%20solo%20archivo.md): Consolidated Epic 4 backlog.
- [`docs/user-stories/01-mvp/02-Registro de Gastos/Epica 1 - historias de usuario en un solo archivo.md`](../../../docs/user-stories/01-mvp/02-Registro%20de%20Gastos/Epica%201%20-%20historias%20de%20usuario%20en%20un%20solo%20archivo.md): Consolidated Epic 1 backlog.
- [`docs/user-stories/01-mvp/02-Registro de Gastos/Tabla resumen — Épica 1.md`](../../../docs/user-stories/01-mvp/02-Registro%20de%20Gastos/Tabla%20resumen%20%E2%80%94%20%C3%89pica%201.md): Epic 1 release and estimation summary, including the stale `E1-US-13` description.
- [`docs/features/category-confirmation.md`](../../../docs/features/category-confirmation.md): Implemented flat-category onboarding behavior that must remain compatible.
- [`docs/features/expense-correction.md`](../../../docs/features/expense-correction.md): Implemented correction, persisted-state, and retry boundaries.
- [`docs/adr/adr.md`](../../../docs/adr/adr.md): Architecture decisions for the modular application, durable FSM, spreadsheet ports, and structured LLM extraction.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): Required functional, failure-path, integration, and FSM coverage.
- [`docs/plans/plan-conventions.md`](../../../docs/plans/plan-conventions.md): Plan structure and execution conventions.

This delivery changes documentation contracts only. It adds no application code, database migration, HTTP route, or FSM state.

## Phases

### Phase 1: Define the hierarchy configuration contract

#### Description

Create the Release 2 Epic 4 story for detecting, editing, and confirming parent/category relationships while retaining flat spreadsheet onboarding.

#### To-do actions

- [x] Create `HU-4.08 — Configure linked categories and subcategories.md` under the Release 2 spreadsheet-linking epic with Gherkin acceptance scenarios.
- [x] Specify optional subcategory mapping, row-pair preservation, empty hierarchy fallback, and explicit orphan reporting.
- [x] Specify parent-scoped duplicate invariants and add, rename, move, and remove commands.
- [x] Define an atomic confirmation boundary and backward compatibility for spreadsheets without a subcategory column.
- [x] Assign the story to Release 2 with 8 story points and retain `HU-4.06` and `HU-4.07` as dependencies.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Define the linked expense lifecycle contract

#### Description

Create the Release 2 Epic 1 story covering classification, review, correction, saving, retry, and audit behavior for an optional linked subcategory.

#### To-do actions

- [x] Create `E1-US-18 — Classify and register linked subcategories.md` with Gherkin scenarios for parent-first classification and parent-isolated subcategory matching.
- [x] Define optional review behavior, atomic correction rules, spreadsheet-save ordering, retry compatibility, and historical snapshots.
- [x] Define legacy JSONB compatibility and behavior for users without subcategory support.
- [x] Make `HU-4.08` a dependency and retain the existing category, review, correction, confirmation, save, and failure dependencies.
- [x] Assign the story to Release 2 with 8 story points and add a testable Definition of Done.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Synchronize consolidated backlog views

#### Description

Add both Release 2 stories to the consolidated epic documents and summary tables, and document the existing `E1-US-13` collision without renaming historical story directories.

#### To-do actions

- [x] Add `HU-4.08` to the consolidated Epic 4 story document and summary table with corrected release totals.
- [x] Add `E1-US-18` to the consolidated Epic 1 story document and summary table with corrected release totals.
- [x] Change the stale consolidated `E1-US-13` summary description to the implemented pending-expense queue story.
- [x] Retain the historical Release 2 `E1-US-13` directory and add an explicit traceability note about the ID collision.
- [x] Verify that the individual and consolidated story contracts agree on scope, dependencies, release, and points.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Create the additive data and domain foundation subplan defined by Phase 2 of the linked-subcategory master plan.
