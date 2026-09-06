# Subcategory Classification and Expense Review

## Goal

Classify an optional subcategory only within its resolved active parent and carry stable category/subcategory selections into expense review. Show the linked result only when hierarchy support is enabled, while preserving existing category-only review output and deferring spreadsheet and local expense persistence to the release subplan.

## Context

- [`src/domain/entities/ExpenseRecord.ts`](../../../src/domain/entities/ExpenseRecord.ts): Current `ExtractedExpense` contract and category confidence type.
- [`src/domain/ports/services.ts`](../../../src/domain/ports/services.ts): Current flat `UserContext` and `LLMPort.extractExpense()` boundary shared by every provider.
- [`src/infrastructure/adapters/llm/OpenAIAdapter.ts`](../../../src/infrastructure/adapters/llm/OpenAIAdapter.ts): OpenAI extraction schema, prompt, untrusted-context serialization, and result mapping.
- [`src/infrastructure/adapters/llm/ClaudeAdapter.ts`](../../../src/infrastructure/adapters/llm/ClaudeAdapter.ts): Claude extraction schema, prompt, parsing, and result mapping.
- [`src/infrastructure/adapters/llm/NvidiaAdapter.ts`](../../../src/infrastructure/adapters/llm/NvidiaAdapter.ts): NVIDIA extraction schema, prompt, parsing, and result mapping.
- [`src/application/ports/in/categoryClassifier.port.ts`](../../../src/application/ports/in/categoryClassifier.port.ts): Current name-only classifier input and output port.
- [`src/domain/value-objects/ClassificationResult.ts`](../../../src/domain/value-objects/ClassificationResult.ts): Current category-only result union and confidence/status semantics.
- [`src/application/use-cases/expense/ClassifyExpenseCategory.ts`](../../../src/application/use-cases/expense/ClassifyExpenseCategory.ts): Current exact LLM, keyword, ambiguity, and category fallback resolution.
- [`src/domain/entities/CategoryVocabulary.ts`](../../../src/domain/entities/CategoryVocabulary.ts): Active hierarchy aggregate and parent-scoped subcategory lookup.
- [`src/domain/ports/repositories.ts`](../../../src/domain/ports/repositories.ts): `ICategoryVocabularyRepository` contract for loading active stable parent/child identifiers.
- [`src/application/use-cases/expense/RegisterExpense.ts`](../../../src/application/use-cases/expense/RegisterExpense.ts): LLM context construction, classification, review payload construction, and `EXPENSE_REVIEW` transition.
- [`src/domain/value-objects/expense-review-payload.ts`](../../../src/domain/value-objects/expense-review-payload.ts): Persisted review payload shared with correction, confirmation, retry, and queue flows.
- [`src/application/dtos/expense-summary.dto.ts`](../../../src/application/dtos/expense-summary.dto.ts): Channel-neutral expense summary contract.
- [`src/application/use-cases/expense/GenerateExpenseSummaryUseCase.ts`](../../../src/application/use-cases/expense/GenerateExpenseSummaryUseCase.ts): Review DTO construction and high-amount behavior.
- [`src/infrastructure/adapters/telegram/TelegramExpenseSummaryPresenter.ts`](../../../src/infrastructure/adapters/telegram/TelegramExpenseSummaryPresenter.ts): Telegram summary formatting, status markers, and action buttons.
- [`src/interfaces/workers/message.worker.ts`](../../../src/interfaces/workers/message.worker.ts): Review-payload guard and all paths that re-present an expense summary.
- [`src/bootstrap/buildDependencies.ts`](../../../src/bootstrap/buildDependencies.ts): Classifier, hierarchy repository, register-expense, summary, and presenter dependency wiring.
- [`docs/adr/adr.md`](../../../docs/adr/adr.md): ADR-002 provider-neutral structured LLM extraction, ADR-003 persisted FSM, and ADR-005 asynchronous processing constraints.
- [`docs/adr/ADR-022-linked-subcategory-hierarchy.md`](../../../docs/adr/ADR-022-linked-subcategory-hierarchy.md): Active parent hierarchy, stable identifiers, parent-scoped uniqueness, and snapshot/reference decision.
- [`docs/architecture/module-contracts.md`](../../../docs/architecture/module-contracts.md): Clean Architecture import and dependency-injection boundaries.
- [`docs/architecture/async-pipeline.md`](../../../docs/architecture/async-pipeline.md): Worker-owned LLM, classification, state, and presentation flow that must remain outside HTTP routes.
- [`docs/features/expense-summary-review.md`](../../../docs/features/expense-summary-review.md): Current five-field summary, confidence markers, high-amount handling, and category-only presentation contract.
- [`docs/features/subcategory-hierarchy.md`](../../../docs/features/subcategory-hierarchy.md): Implemented capability activation and active parent/child vocabulary rules.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): LLM adapter, application, worker, FSM, failure-path, and full-suite testing requirements.
- [`E1-US-18 - Classify and register linked subcategories`](../../../docs/user-stories/02-release-2-producto-complejo/01-epica-1/E1-US-18%20%E2%80%94%20Classify%20and%20register%20linked%20subcategories.md): Canonical parent isolation, independent confidence, compatibility, and review acceptance criteria.
- [`Subcategory Onboarding Management and Confirmation`](../2026_09_02-subcategory_onboarding_management/2026_09_02-subcategory_onboarding_management-plan.md): Completed prerequisite that activates and persists the reviewed hierarchy.

### Public contracts introduced or extended

- `CategoryHierarchyContext`: an ordered, provider-neutral LLM context containing active category names and each category's active subcategory names. It is serialized as untrusted data and never grants the LLM authority to validate a relationship.
- `UserContext`: retains `categories: string[]` for current consumers and adds hierarchy context plus an explicit `subcategoryEnabled` capability. The capability is true when the spreadsheet has a confirmed `subcategoria` mapping or its active vocabulary contains at least one configured subcategory.
- `ExtractedExpense`: adds `subcategoriaRaw: string | null` and `confianzaSubcategoria: CategoryConfidence`. Every provider returns both keys; an absent or unsupported child is represented by `null` and `nula` independently of category confidence.
- `ClassifyExpenseCategoryInput`: adds the spreadsheet identifier and raw/confidence subcategory inputs required to load the active hierarchy and classify beneath the selected parent.
- `ClassificationSelection`: `{ id: string | null; name: string | null; status: 'confirmed' | 'ambiguous' | 'fallback' | 'none'; confidence: CategoryConfidence }`.
- `HierarchicalClassificationResult`: `{ category: ClassificationSelection; subcategory: ClassificationSelection & { categoryId: string | null } }`. A selected child always carries the selected category ID; a missing selection carries null identifiers/names and `none`/`nula`.
- `ExpenseReviewPayload`: new payloads include `resolvedSubcategory`, `resolvedSubcategoryId`, `subcategoryStatus`, and `subcategoryEnabled`; the fields remain optional at the persisted TypeScript boundary so pre-deployment JSONB payloads continue as hierarchy-disabled reviews until the centralized legacy normalization work in the correction subplan.
- `ExpenseSummary`: adds subcategory name, confidence, status, and capability fields for channel-neutral rendering. Existing category fields, action flags, date defaults, and high-amount flags remain unchanged.

## Phases

### Phase 1: Extend hierarchical LLM extraction contracts

#### Description

Give every extraction provider the same optional hierarchy-aware schema and prompt. The LLM may suggest a category and subcategory independently, but the deterministic classifier remains the authority for stable IDs and parent membership.

#### To-do actions

- [x] Extend `ExtractedExpense` with required `subcategoriaRaw: string | null` and `confianzaSubcategoria: CategoryConfidence`; update every test builder and direct fixture so new runtime objects are canonical without weakening existing category fields.
- [x] Add the ordered `CategoryHierarchyContext` shape to `UserContext`, retain the flat category list for existing correction and mapping consumers, and add the explicit `subcategoryEnabled` capability used by extraction and review.
- [x] In `RegisterExpenseUseCase.interpret()`, load the active `CategoryVocabulary` for the resolved spreadsheet and the confirmed column mappings, then set `subcategoryEnabled` when a `subcategoria` mapping exists or active configured children exist.
- [x] Build LLM hierarchy context only from active aggregate parents and their active children, preserve configured names and parent relationships, and provide an empty hierarchy plus `subcategoryEnabled: false` when the user has no spreadsheet or hierarchy capability.
- [x] Extend the OpenAI, Claude, and NVIDIA extraction Zod schemas with `subcategoria_raw` and `confianza_subcategoria`; require explicit null/`nula` values rather than provider-specific omission or coercion.
- [x] Update the shared extraction instructions to distinguish category from subcategory, request independent confidence, allow a valid parent without a child, and forbid inventing or moving a child between parents.
- [x] Include the ordered hierarchy and capability in each provider's existing `serializeUntrustedData()` payload so spreadsheet vocabulary remains data, never prompt instructions.
- [x] Map the validated snake-case provider result to the canonical camel-case `ExtractedExpense` identically in all three adapters; preserve malformed JSON/schema failure behavior.
- [x] Extend `OpenAIAdapter.spec.ts`, `ClaudeAdapter.spec.ts`, and `NvidiaAdapter.spec.ts` with valid linked extraction, absent subcategory, independent confidence, hierarchy-context serialization, same child name under different parents, malformed subcategory fields, and untrusted-vocabulary prompt-injection coverage.
- [x] Extend `RegisterExpense.spec.ts` with mapping-enabled, configured-hierarchy-enabled, and flat-user context construction while asserting that disabled users send the same flat categories and no invented children.
- [x] Run the focused `ExtractedExpense`, register-expense context, and all three LLM adapter test suites.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Resolve a parent-first stable hierarchy selection

#### Description

Replace the name-only classification result with one stable parent/child selection. Resolve the active category first, then run every child strategy against only that parent's active subcategories.

#### To-do actions

- [x] Replace the category-only `ClassificationResult` public union with `ClassificationSelection` and `HierarchicalClassificationResult`; provide constructors and type guards that keep `confirmed`, `ambiguous`, `fallback`, and `none` explicit for each level.
- [x] Extend `ClassifyExpenseCategoryInput` with `spreadsheetId`, `llmSubcategory`, and `llmSubcategoryConfidence`, and inject `ICategoryVocabularyRepository` into `ClassifyExpenseCategory` through `buildDependencies.ts`.
- [x] Preserve the current category strategy order and thresholds, but bind every resolved category name to the active aggregate so a successful result contains its persisted UUID; a stale keyword or fallback name that is not active becomes a category `none` selection.
- [x] Stop child classification when the parent selection has no active ID, returning subcategory `{ id: null, name: null, categoryId: null, status: 'none', confidence: 'nula' }` regardless of the LLM child suggestion.
- [x] Restrict the child candidate set to `CategoryVocabulary.getSubcategories(selectedCategory.id)` before exact, keyword, or fallback work; never inspect or return an equal normalized child belonging to another parent.
- [x] Resolve a high-confidence exact normalized LLM child first, then deterministic whole-name/phrase matches from the raw message, then a conservative fuzzy fallback against only the selected parent's child names; do not auto-select a sole child without textual evidence.
- [x] Add a narrow subcategory fallback matcher contract or reusable deterministic matcher that accepts arbitrary child names and returns no result for absent, tied, or over-threshold candidates; do not widen the canonical-category-only fallback contract unsafely.
- [x] Mark exact or decisive keyword child matches as `confirmed`, tied/insufficiently separated matches as `ambiguous`, conservative approximate matches as `fallback`, and no valid child as `none`, independently of the parent status.
- [x] Update `RegisterExpenseUseCase.interpret()` and its zero-amount payload helper to pass both LLM suggestions/confidences, consume the hierarchical result once, and populate stable category plus optional child IDs/names/statuses without changing clarification priority or adding an FSM state.
- [x] Keep a resolved category when no child matches, and make all newly constructed review payloads include explicit null child values plus the computed `subcategoryEnabled` flag for deterministic serialization.
- [x] Leave `RegisterExpenseUseCase.save()`, spreadsheet row construction, expense-record persistence, retry, correction, cancellation, and undo semantics unchanged in this subplan; Phase 7 will consume the reviewed identifiers/snapshots for persistence.
- [x] Replace and extend `ClassificationResult.spec.ts` and `ClassifyExpenseCategory.spec.ts` for stable IDs, exact parent and child matches, category keyword and fallback behavior, child phrase/keyword and fallback behavior, confidence/status independence, ambiguous children, no-evidence single child, missing hierarchy, unresolved parent, no valid child, inactive/stale candidates, and equal child names under different parents.
- [x] Extend `RegisterExpense.spec.ts` for ready, zero-amount, date-default, and category-only payloads plus explicit assertions that classification never writes to the spreadsheet or expense repository during interpretation.
- [x] Extend bootstrap dependency tests for the active hierarchy repository and subcategory matcher wiring.
- [x] Run the focused classification result, classifier, register-expense, and dependency-wiring test suites.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Present hierarchy-aware reviews and close documentation

#### Description

Carry the optional child selection through the channel-neutral summary and Telegram presenter. Hierarchy-enabled users see an explicit subcategory row and confidence marker; hierarchy-disabled and legacy payloads retain the current output.

#### To-do actions

- [ ] Extend `ExpenseReviewPayload` with the optional backward-compatible subcategory fields and document the invariant that all new `RegisterExpenseUseCase` payloads set them explicitly, while missing legacy fields mean null child values and `subcategoryEnabled: false` at presentation time.
- [ ] Extend `ExpenseSummary` and `GenerateExpenseSummaryUseCase` with subcategory name, independent confidence/status, and capability values without changing concept, amount, currency, category, date, actions, or high-amount calculations.
- [ ] Normalize missing subcategory review fields locally when building the summary so a legacy `EXPENSE_REVIEW` JSONB payload renders successfully; defer correction, queue, and retry validator normalization to Phase 6 as planned.
- [ ] Update `TelegramExpenseSummaryPresenter` to add `Subcategoría: <name>` with the same confirmed/ambiguous/fallback/none marker semantics only when `subcategoryEnabled` is true; render an explicit no-subcategory value when the capability is enabled but no child was selected.
- [ ] Preserve the exact current normal and high-amount summary text, line order, buttons, timeout copy, and explicit-confirmation flow when hierarchy support is disabled or legacy fields are missing.
- [ ] Verify every worker path that presents or re-presents a review delegates the expanded payload unchanged through `GenerateExpenseSummaryUseCase`; keep the existing permissive payload guard and the `EXPENSE_REVIEW` state unchanged.
- [ ] Extend `GenerateExpenseSummaryUseCase.spec.ts` for selected, missing, ambiguous, and fallback subcategories, independently differing parent/child confidences, capability-disabled behavior, legacy missing fields, date defaults, and high-amount flags.
- [ ] Extend `TelegramExpenseSummaryPresenter.spec.ts` for enabled selected/no-child displays, child confidence markers, exact hierarchy-disabled output regression, action buttons, high-amount formatting, and no duplicate summary presentation.
- [ ] Extend `message.worker.spec.ts` for initial review, zero-amount confirmation, clarification completion, and review re-presentation with hierarchical and legacy payloads; assert one presentation, no new FSM state, and unchanged disabled-user output.
- [ ] Update `docs/features/expense-summary-review.md` with hierarchy activation, optional child display, independent confidence markers, category-without-child behavior, legacy output, and QA/test coverage.
- [ ] Update `docs/features/subcategory-hierarchy.md` with parent-first classification, active-parent isolation, stable review identifiers, capability activation, no-child behavior, and the explicit Phase 5 persistence boundary.
- [ ] Synchronize the affected entries in `docs/features/README.md` in the same documentation change.
- [ ] Run the focused summary use-case, Telegram presenter, worker, register-expense, classifier, and LLM adapter suites.
- [ ] Run `pnpm test` to execute the complete project test suite after the focused tests pass.
- [ ] Run `pnpm run format:check` to verify the TypeScript, tests, plan-driven feature documentation, and feature index follow repository formatting.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Implement Phase 3 to present hierarchy-aware reviews and close documentation.
