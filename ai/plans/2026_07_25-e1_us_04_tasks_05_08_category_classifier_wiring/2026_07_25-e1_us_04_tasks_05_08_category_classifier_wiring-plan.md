# Plan: E1-US-04 Tasks 5-8 — Category Classifier Wiring

## Goal

Complete the remaining E1-US-04 tasks by implementing the concrete category vocabulary and fallback adapters, integrating the existing keyword classifier into the expense registration flow, and surfacing ambiguity / fallback / no-match states in the conversation summary. After implementation, meaningful tests will cover the four Gherkin classification scenarios and the corresponding user-story task files will be updated.

## Context

- User story: `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-04-assignment-of-category-by-keywords-in-text/E1-US-04 — Category assignment by keywords in the text.md`
- Task files:
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-04-assignment-of-category-by-keywords-in-text/tasks/T-E1-US-04-05.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-04-assignment-of-category-by-keywords-in-text/tasks/T-E1-US-04-06.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-04-assignment-of-category-by-keywords-in-text/tasks/T-E1-US-04-07.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-04-assignment-of-category-by-keywords-in-text/tasks/T-E1-US-04-08.md`
- Existing classifier foundation (already implemented):
  - `src/domain/value-objects/CategoryKeywordVocabulary.ts`
  - `src/domain/value-objects/ClassificationResult.ts`
  - `src/application/ports/in/categoryClassifier.port.ts`
  - `src/application/ports/output/categoryKeywordVocabularyRepository.port.ts`
  - `src/application/ports/output/categoryFallbackMapper.port.ts`
  - `src/application/use-cases/expense/ClassifyExpenseCategory.ts`
  - `src/application/use-cases/expense/ClassifyExpenseCategory.spec.ts`
- Expense registration flow:
  - `src/application/use-cases/expense/RegisterExpense.ts`
  - `src/application/use-cases/expense/RegisterExpense.spec.ts`
  - `src/interfaces/workers/message.worker.ts`
  - `src/interfaces/workers/message.worker.spec.ts`
- Category vocabulary persistence:
  - `src/infrastructure/db/schema/index.ts` (`user_categories` table)
  - `src/infrastructure/db/repositories/DrizzleUserCategoryRepository.ts`
  - `src/domain/entities/CategoryVocabulary.ts`
  - `src/infrastructure/db/repositories/DrizzleCategoryVocabularyRepository.ts`
- User-facing copy:
  - `src/application/copies/expense.copies.ts`
- Bootstrap wiring:
  - `src/bootstrap/buildDependencies.ts`
  - `src/bootstrap/types.ts`
- Reference docs:
  - `docs/plans/plan-conventions.md`
  - `docs/features/category-confirmation.md`
  - `docs/architecture/data-model.md`
  - `AGENTS.md`

## Phases

### Phase 1 — Infrastructure adapters

Implement the two missing adapters so the classifier can load a real vocabulary and fall back gracefully when an inferred category is not present in the user's spreadsheet.

#### Public contracts

- `src/infrastructure/db/repositories/DrizzleCategoryKeywordVocabularyRepository.ts`
  - Implements `ICategoryKeywordVocabularyRepository`.
  - `findByUserId(userId: string): Promise<CategoryKeywordVocabulary>`.
  - Loads the active spreadsheet config for the user, reads active categories through `IUserCategoryRepository`, and returns `CategoryKeywordVocabulary.createBase().withUserCategories(...)`.
  - Falls back to the base vocabulary when the user has no spreadsheet config or no active categories.

- `src/infrastructure/adapters/CategoryFallbackMapper.ts`
  - Implements `ICategoryFallbackMapper`.
  - `findClosest(inferred: CanonicalCategory, available: readonly string[]): Promise<string | null>`.
  - Deterministic strategy: exact canonical display-name match, normalized substring containment, then Levenshtein distance under a fixed small threshold; otherwise returns `null`.

#### To-do actions

- [x] Create `DrizzleCategoryKeywordVocabularyRepository.ts` implementing the keyword vocabulary repository port.
- [x] Create `DrizzleCategoryKeywordVocabularyRepository.spec.ts` with stubbed `ISpreadsheetConfigRepository` and `IUserCategoryRepository`, covering:
  - [x] Base vocabulary returned when the user has no config.
  - [x] Base vocabulary returned when no active categories exist.
  - [x] User categories merged into the base vocabulary.
  - [x] Case-insensitive / normalized matching of user category names.
- [x] Create `CategoryFallbackMapper.ts` implementing the fallback mapper port.
- [x] Create `CategoryFallbackMapper.spec.ts` covering:
  - [x] Exact canonical display-name match.
  - [x] Normalized substring containment match.
  - [x] Levenshtein-based match below the threshold.
  - [x] `null` returned when no reasonable match exists.
- [x] Run `pnpm run lint` and `pnpm run typecheck`. Fix issues.
- [x] Ask the user if they want to review the changes before continuing.

### Phase 2 — Wire classifier into the expense flow

Connect the classifier to `RegisterExpenseUseCase`, update the review payload, and surface classification state in the user-facing summary.

#### Public contracts

- `src/application/use-cases/expense/RegisterExpense.ts`
  - Constructor receives `ICategoryClassifier`.
  - After amount and currency are resolved, calls `classifier.execute({ userId, rawMessage, llmCategory: extracted.categoriaRaw, llmConfidence: extracted.confianzaCategoria })`.
  - Replaces the existing `resolveCategory` helper with the classifier result.
  - Stores the resolved category plus classification metadata in the review payload.

- `ExpenseReviewPayload`
  - Adds `categoryStatus: 'confirmed' | 'ambiguous' | 'fallback' | 'none'`.
  - Keeps `resolvedCategory` and `resolvedCategoryId` for backward compatibility.

- `src/application/copies/expense.copies.ts`
  - `expenseSummary` and `updatedSummary` add a hint when `categoryStatus` is `ambiguous` or `fallback`, and show the empty-category placeholder when it is `none`.

- `src/interfaces/workers/message.worker.ts`
  - `formatExpenseSummary` passes the new `categoryStatus` to the copy functions.

- `src/bootstrap/buildDependencies.ts` and `src/bootstrap/types.ts`
  - Instantiate `DrizzleCategoryKeywordVocabularyRepository`, `CategoryFallbackMapper`, and `ClassifyExpenseCategory`.
  - Inject the classifier into `RegisterExpenseUseCase`.

- `src/application/use-cases/expense/RegisterExpense.spec.ts`
  - Mock the classifier and assert the payload carries the correct category and status for each classification state.

#### To-do actions

- [x] Update `RegisterExpenseUseCase` constructor to accept `ICategoryClassifier`.
- [x] Update `RegisterExpenseUseCase.interpret` to call the classifier after amount/currency resolution.
- [x] Extend `ExpenseReviewPayload` with `categoryStatus`.
- [x] Update `expenseSummary` and `updatedSummary` to surface ambiguity / fallback / no-match hints.
- [x] Update `message.worker.ts` `formatExpenseSummary` to pass the new status.
- [x] Update `buildDependencies.ts` and `src/bootstrap/types.ts` to wire the new adapters.
- [x] Update `RegisterExpense.spec.ts` to mock the classifier and assert classification metadata.
- [x] Run `pnpm run lint` and `pnpm run typecheck`. Fix issues.
- [x] Ask the user if they want to review the changes before continuing.

### Phase 3 — Classification scenario tests and acceptance closure

Ensure the Gherkin scenarios are covered by meaningful tests, run the full test suite, and update the task acceptance checkboxes.

#### Public contracts

- Test suites:
  - `src/application/use-cases/expense/ClassifyExpenseCategory.spec.ts`
    - Unambiguous keyword present in the message.
    - Multiple possible keywords all pointing to the same category.
    - Ambiguous keywords exceeding the confidence threshold.
    - No relevant keyword detected.
    - Inferred category not in the user's spreadsheet.
  - `src/application/use-cases/expense/RegisterExpense.spec.ts`
    - Classification metadata flows correctly into the review payload.
  - `src/interfaces/workers/message.worker.spec.ts`
    - Summary text reflects ambiguity, fallback, and no-match states.

- User-story task files:
  - `T-E1-US-04-05.md`, `T-E1-US-04-06.md`, `T-E1-US-04-07.md`, `T-E1-US-04-08.md` acceptance checkboxes will be checked off.

#### To-do actions

- [x] Review `ClassifyExpenseCategory.spec.ts` and add or tighten any missing Gherkin coverage.
- [x] Add `RegisterExpense.spec.ts` tests for classification status propagation.
- [x] Add `message.worker.spec.ts` tests for summary rendering of ambiguous / fallback / no-match states.
- [x] Run `pnpm test` and confirm all tests pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck`. Fix issues.
- [x] Update the acceptance checkboxes in the four E1-US-04 task files.
- [x] Ask the user if they want to review the final changes.

## Next step

All phases completed. Suggest exporting this conversation and storing it as `ai/plans/2026_07_25-e1_us_04_tasks_05_08_category_classifier_wiring/2026_07_25-e1_us_04_tasks_05_08_category_classifier_wiring-conversation.md`.
