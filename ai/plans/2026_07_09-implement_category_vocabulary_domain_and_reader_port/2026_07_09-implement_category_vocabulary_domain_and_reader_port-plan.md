# Plan: Implement category vocabulary domain model, reader port, and aggregate repository

## Goal

Refactor the existing category detection flow so that the Application layer depends only on Domain ports, not on Infrastructure adapters. Introduce a `CategoryVocabulary` domain aggregate with invariants, define a `ICategoryReaderPort` for spreadsheet category extraction, and implement an aggregate-oriented repository that maps between `CategoryVocabulary` and the existing `user_categories` schema.

## Context

### Current state

- **`src/application/use-cases/spreadsheet/DetectCategories.ts`**: The use case directly imports `SpreadsheetCategoryReader` from Infrastructure and instantiates it inline. This breaks the Clean Architecture boundary (Application must not depend on Infrastructure).
- **`src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.ts`**: Already handles deduplication, trimming, and normalization. It wraps a `SpreadsheetPort` and has unit tests. This logic will be promoted behind a Domain port.
- **`src/domain/entities/SpreadsheetConfig.ts`**: Defines `UserCategory` as a flat entity, but there is no aggregate root (`CategoryVocabulary`) that enforces cross-cutting invariants such as "no duplicate normalized names".
- **`src/infrastructure/db/schema/index.ts`**: The `user_categories` table exists with `raw_value`, `normalized_value`, `usage_count`, and `is_active`. It can store a full vocabulary but the current repository only exposes row-level CRUD.
- **`src/infrastructure/db/repositories/DrizzleUserCategoryRepository.ts`**: Implements `IUserCategoryRepository` with `findActiveBySpreadsheetId`, `upsertMany`, and `incrementUsage`. It will be extended (or a new repository created) to load and save the full `CategoryVocabulary` aggregate.
- **`src/domain/ports/repositories.ts`**: Defines `IUserCategoryRepository`. A new `ICategoryVocabularyRepository` will be added here.
- **`src/main.ts`**: Wires all use cases and adapters. The new port implementation must be injected here.
- **`src/application/use-cases/spreadsheet/DetectCategories.spec.ts`**: Mocks `SpreadsheetPort` directly. It must be updated to mock the new `ICategoryReaderPort`.
- **`docs/plans/plan-conventions.md`**: Plan structure and mandatory phase-end tasks.
- **`AGENTS.md`**: Tech stack (Node, TypeScript, Drizzle ORM, Vitest, Fastify, BullMQ), Clean Architecture rules, and done gates (`pnpm lint && pnpm typecheck && pnpm test`).

### What already works

- The `SpreadsheetCategoryReader` unit tests pass and cover edge cases (empty values, trimming, deduplication).
- The `DetectCategories` use case end-to-end test passes, including the fallback to default categories when the column is empty.
- The `userCategories` schema and Drizzle repository are already applied in production.

## Phases

### Phase 1: Domain model, reader port, and application refactor

**Description:**
Create the `Category` entity and `CategoryVocabulary` aggregate in the Domain layer. Define the `ICategoryReaderPort` so the Application layer can request unique category values without knowing about spreadsheets. Refactor `DetectCategories` to accept the port via constructor DI, update `SpreadsheetCategoryReader` to implement the port, and adjust `main.ts` wiring and unit tests.

**To-do actions:**

- [x] Create `src/domain/entities/Category.ts` with `id`, `name`, `normalizedName`.
- [x] Create `src/domain/entities/CategoryVocabulary.ts` as the aggregate root. Methods: `addCategory(name)`, `removeCategory(id)`, `renameCategory(id, newName)`. Invariant: duplicate `normalizedName` is rejected.
- [x] Create `src/domain/ports/categoryReader.ts` with `ICategoryReaderPort` interface (method `readCategories(spreadsheetId, columnIndex, sheetName): Promise<string[]>`) and `ICategoryReaderPortFactory`.
- [x] Update `src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.ts` to implement `ICategoryReaderPort` and export it from the adapter index.
- [x] Create `src/infrastructure/adapters/sheets/SpreadsheetCategoryReaderFactory.ts` implementing `ICategoryReaderPortFactory`.
- [x] Refactor `src/application/use-cases/spreadsheet/DetectCategories.ts` to replace the inline `SpreadsheetCategoryReader` instantiation with an injected `ICategoryReaderPortFactory` dependency.
- [x] Update `src/main.ts` to wire `SpreadsheetCategoryReaderFactory` into `DetectCategories`.
- [x] Update `src/application/use-cases/spreadsheet/DetectCategories.spec.ts` to mock `ICategoryReaderPortFactory` instead of `SpreadsheetPortFactory`.
- [x] Add `src/domain/entities/CategoryVocabulary.spec.ts` with Vitest unit tests covering add/remove/rename invariants and duplicate-name rejection.
- [x] Run `pnpm lint && pnpm typecheck && pnpm test` to verify linting, typechecking, and tests. All passed (792 tests, 0 lint errors, 0 type errors).

### Phase 2: Aggregate repository and schema alignment

**Description:**
Define the `ICategoryVocabularyRepository` port in the Domain layer and implement it in `DrizzleUserCategoryRepository` (or a new repository class). The repository must translate between the `CategoryVocabulary` aggregate and the existing `user_categories` rows. Update documentation and add tests.

**To-do actions:**

- [x] Define `ICategoryVocabularyRepository` in `src/domain/ports/repositories.ts` with methods: `findBySpreadsheetId(spreadsheetId: string): Promise<CategoryVocabulary | null>` and `save(vocabulary: CategoryVocabulary): Promise<void>`.
- [x] Create `DrizzleCategoryVocabularyRepository.ts` implementing `ICategoryVocabularyRepository`.
  - `findBySpreadsheetId` loads active rows for the spreadsheet, maps them into `Category` entities, and assembles a `CategoryVocabulary`.
  - `save` diffs the aggregate against the current DB rows and performs `insert` / `update` / `soft-delete` (set `is_active = false`) within a Drizzle transaction.
- [x] No schema changes needed. The `CategoryVocabulary` aggregate does not require `updatedAt` tracking.
- [x] Add `DrizzleCategoryVocabularyRepository.spec.ts` with unit tests verifying load, save with empty DB, save with soft-delete, and reactivation via upsert.
- [x] Update `docs/architecture/data-model.md` to document the `CategoryVocabulary` aggregate, its invariants, and the repository contract.
- [x] Run `pnpm lint && pnpm typecheck && pnpm test` to verify linting, typechecking, and tests. All passed (797 tests, 0 lint errors, 0 type errors).

## Next step

Both phases of this plan are complete. Proceed to **Phase 3** (not in this plan): implement the Application-layer use cases that consume the new domain model and repository — `DetectCategories` presentation refactor, `ConfirmCategories`, and `AddOrCorrectCategories` (natural-language parsing). These correspond to tasks **T-4.07-04**, **T-4.07-05**, and **T-4.07-06** from the User Story task breakdown.
