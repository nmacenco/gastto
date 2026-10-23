# Plan: E1-US-04 Tasks 1-4 — Category Classifier Foundation

## Goal

Implement the domain models and application-layer classifier foundation for E1-US-04, so the system can classify expense categories from free-text keywords with confidence, ambiguity, and fallback handling. This plan covers the first four atomic tasks of the user story: domain value objects, application ports, and the keyword-based classifier use case.

## Context

- User Story folder: `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-04-assignment-of-category-by-keywords-in-text/`
- Task files:
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-04-assignment-of-category-by-keywords-in-text/tasks/T-E1-US-04-01.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-04-assignment-of-category-by-keywords-in-text/tasks/T-E1-US-04-02.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-04-assignment-of-category-by-keywords-in-text/tasks/T-E1-US-04-03.md`
  - `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-04-assignment-of-category-by-keywords-in-text/tasks/T-E1-US-04-04.md`
- Existing domain model: `src/domain/entities/CategoryVocabulary.ts` holds confirmed user categories but does not include keyword mappings yet.
- Existing repository port: `src/domain/ports/repositories.ts` defines `ICategoryVocabularyRepository` and `IUserCategoryRepository`.
- Existing expense entity: `src/domain/entities/ExpenseRecord.ts` defines `CategoryConfidence` and `ExtractedExpense`.
- Existing use case to consume the classifier: `src/application/use-cases/expense/RegisterExpense.ts` currently resolves categories with `resolveCategory()`.
- Reference deterministic service: `src/application/services/ExtractAmountCurrency.ts` follows the same pattern (rule-based application service with discriminated result value object).
- Configuration schema: `src/config/env.schema.ts`.
- Stack conventions from `AGENTS.md`: TypeScript, Fastify, Zod, Vitest, Drizzle ORM, PostgreSQL, Redis, Pino logging, Clean Architecture boundaries.

## Phases

### Phase 1 — Domain value objects

Create the immutable domain value objects that model the keyword vocabulary and the classification result. This phase is a vertical slice because both value objects can be unit-tested in isolation and represent the core language of the feature.

#### Public contracts

- `src/domain/value-objects/CategoryKeywordVocabulary.ts`
  - `static createBase(): CategoryKeywordVocabulary` — base Spanish keyword map for the canonical categories `food`, `transport`, `housing`, `health`, `entertainment`, `services`.
  - `withUserCategories(userCategories: readonly string[]): CategoryKeywordVocabulary` — returns a new immutable vocabulary extended with user category names as keywords.
  - `findBestMatch(text: string): CategoryKeywordMatch` — case- and diacritic-insensitive token matching.
  - `CategoryKeywordMatch` type: `{ canonicalCategory: CanonicalCategory | null; matchedKeywords: number; totalKeywords: number }`.

- `src/domain/value-objects/ClassificationResult.ts`
  - `static highConfidence(category: string): ClassificationResult`
  - `static ambiguous(proposedCategory: string): ClassificationResult`
  - `static fallback(proposedCategory: string): ClassificationResult`
  - `static noMatch(): ClassificationResult`
  - Readonly properties: `kind`, `category`, `confidence` (mapped to `CategoryConfidence`), `isAmbiguous`, `isFallback`.

- `src/domain/value-objects/index.ts` — export both new value objects.

#### To-do actions

- [x] Create `CategoryKeywordVocabulary.ts` with base Spanish keyword map and immutable extension method.
- [x] Create `ClassificationResult.ts` with discriminated result states and factory methods.
- [x] Export both value objects from `src/domain/value-objects/index.ts`.
- [x] Add unit tests for `CategoryKeywordVocabulary`:
  - [x] Base keyword matches a canonical category.
  - [x] Case and diacritic insensitivity.
  - [x] Merging user categories without mutating the base vocabulary.
  - [x] Multiple keywords pointing to the same category.
- [x] Add unit tests for `ClassificationResult`:
  - [x] High-confidence state.
  - [x] Ambiguous state.
  - [x] Fallback state.
  - [x] No-match state.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2 — Application ports

Define the application-layer ports that keep the classifier decoupled from infrastructure. The input port is the service contract consumed by `RegisterExpenseUseCase`. The output ports fetch the keyword vocabulary and handle unknown-category fallback.

#### Public contracts

- `src/application/ports/in/categoryClassifier.port.ts`
  - `export interface ICategoryClassifier`
  - `execute(input: { userId: string; rawMessage: string; llmCategory: string | null; llmConfidence: CategoryConfidence }): Promise<ClassificationResult>`

- `src/application/ports/output/categoryKeywordVocabularyRepository.port.ts`
  - `export interface ICategoryKeywordVocabularyRepository`
  - `findByUserId(userId: string): Promise<CategoryKeywordVocabulary>` — builds base vocabulary plus user categories from the existing `ICategoryVocabularyRepository` / `IUserCategoryRepository`.

- `src/application/ports/output/categoryFallbackMapper.port.ts`
  - `export interface ICategoryFallbackMapper`
  - `findClosest(inferred: CanonicalCategory, available: readonly string[]): Promise<string | null>` — returns the closest user category or `null` when no reasonable match exists.

- `src/application/ports/index.ts` — export the new ports.

#### To-do actions

- [x] Create `src/application/ports/in/categoryClassifier.port.ts`.
- [x] Create `src/application/ports/output/categoryKeywordVocabularyRepository.port.ts`.
- [x] Create `src/application/ports/output/categoryFallbackMapper.port.ts`.
- [x] Export the new ports from `src/application/ports/index.ts`.
- [x] Ensure no HTTP, database, or messaging types leak into the port definitions.
- [x] Add minimal type-level tests or compile-time checks to verify port signatures accept domain value objects and plain primitives.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3 — Keyword-based classifier implementation

Implement the application-layer use case that acts as a deterministic fallback/normalizer for category classification. The LLM (`LLMPort.extractExpense`) remains the primary extractor; the keyword classifier is invoked when the LLM's category confidence is low or when the inferred category is not in the user's vocabulary. The use case depends only on the domain value objects and application ports defined in the previous phases.

#### Public contracts

- `src/application/use-cases/expense/ClassifyExpenseCategory.ts`
  - `export class ClassifyExpenseCategory implements ICategoryClassifier`
  - Constructor dependencies: `ICategoryKeywordVocabularyRepository`, `ICategoryFallbackMapper`, and a numeric confidence threshold.
  - `execute(input: { userId: string; rawMessage: string; llmCategory: string | null; llmConfidence: CategoryConfidence }): Promise<ClassificationResult>`
  - Behavior:
    - Load the keyword vocabulary for the user.
    - If the LLM already provided a category with high confidence and it exists in the user's vocabulary → `highConfidence` with that category.
    - If the LLM category is missing, low confidence, or not in the user's vocabulary → run keyword matching.
    - Match keywords and compute confidence as `matchedKeywords / totalKeywords` per canonical category.
    - If one canonical category dominates and confidence >= threshold → `highConfidence` with the resolved user category name.
    - If multiple categories match and the gap between top candidates is below threshold → `ambiguous` with the most likely user category.
    - If no keyword matches → `noMatch`.
    - If the inferred canonical category is not present in the user's categories → `fallback` using `ICategoryFallbackMapper`.

- `src/config/env.schema.ts`
  - New variable: `CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6)`.

#### To-do actions

- [x] Add `CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD` to `src/config/env.schema.ts`.
- [x] Implement `ClassifyExpenseCategory` in `src/application/use-cases/expense/ClassifyExpenseCategory.ts`.
- [x] Keep all business logic in the application use case; do not leak Telegram, WhatsApp, or spreadsheet details.
- [x] Add unit tests for the Gherkin scenarios:
  - [x] Unambiguous keyword present in the message (e.g., "almuerzo" → `highConfidence`).
  - [x] Multiple keywords all point to the same category (e.g., "combustible" + "auto" → `highConfidence`).
  - [x] Ambiguous keywords exceeding the confidence threshold (e.g., "kiosco" → `ambiguous`).
  - [x] No relevant keyword detected (e.g., "Gasté 50 euros hoy" → `noMatch`).
  - [x] Inferred category not in user's spreadsheet (e.g., "entretenimiento" when unavailable → `fallback`).
  - [x] LLM returns high-confidence category in user's vocabulary → keyword classifier confirms it without overwriting.
- [x] Mock the repository and fallback mapper at the boundaries; do not mock internal classifier logic.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All three phases of this plan are complete. The category classifier foundation is implemented: domain value objects, application ports, and the keyword-based `ClassifyExpenseCategory` use case with configuration and unit tests.

Remaining downstream work (outside this plan) includes:
- Implementing the `ICategoryKeywordVocabularyRepository` and `ICategoryFallbackMapper` infrastructure adapters.
- Wiring `ClassifyExpenseCategory` into `RegisterExpenseUseCase` to consume the LLM output as a fallback/normalizer.
- Exporting the conversation as a `.md` file alongside this plan once the phase is reviewed.
