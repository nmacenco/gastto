# Plan: Category vocabulary foundation for HU-4.07

## Goal

Implement the foundational domain model, application ports, and spreadsheet reader adapter needed for the category-vocabulary confirmation flow in HU-4.07. This delivers the ability to detect, normalize, and read unique category values from the user's spreadsheet after column mapping is confirmed.

## Context

- User story: `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.07-confirm-spreadsheet-categories/HU-4.07 — Confirm spreadsheet categories.md`
- Task files:
  - `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.07-confirm-spreadsheet-categories/tasks/T-4.07-01.md`
  - `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.07-confirm-spreadsheet-categories/tasks/T-4.07-02.md`
  - `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.07-confirm-spreadsheet-categories/tasks/T-4.07-03.md`
- Current `SpreadsheetPort.getUniqueValues` throws `SpreadsheetError('getUniqueValues not yet implemented')` in both `GoogleSheetsAdapter` and `ExcelOnlineAdapter`.
- `user_categories` table and `IUserCategoryRepository` already exist, but no `CategoryVocabulary`, `CategoryReaderPort`, `CategoryVocabularyRepositoryPort`, or `OnboardingCompletionPort` exist yet.
- Related feature docs: `docs/features/confirm-or-correct-column-mapping.md`, `docs/features/infer-and-propose-column-mapping.md`.
- Data model reference: `docs/architecture/data-model.md`.
- Architecture decisions: `docs/adr/adr.md` (ADR-003 FSM in PostgreSQL, ADR-004 spreadsheet adapter pattern).

## Public contracts

### Domain model

- `src/domain/value-objects/Category.ts`: immutable category with `name`, optional `displayLabel`, and `order`.
- `src/domain/value-objects/CategoryVocabulary.ts`: value object/entity tracking:
  - `categories: Category[]`
  - `state: 'detecting' | 'confirming' | 'editing' | 'confirmed'`
  - `source: 'detected' | 'default' | 'user-edited'`
  - helper methods: `confirm()`, `withDefaultCategories()`, `addCategory(name)`, `removeCategory(name)`, `renameCategory(from, to)`.
- `DEFAULT_CATEGORY_SET: string[]` constant in the Domain layer.

### Ports

New file: `src/domain/ports/categoryVocabulary.ts`

```ts
export interface ReadUniqueCategoriesInput {
  provider: SpreadsheetProvider;
  fileId: string;
  sheetName: string;
  accessToken: string;
  columnIndex: number;
}

export interface CategoryReaderPort {
  readUniqueCategories(input: ReadUniqueCategoriesInput): Promise<string[]>;
}

export interface CategoryVocabularyRepositoryPort {
  save(userId: string, vocabulary: CategoryVocabulary, ttlSeconds: number): Promise<void>;
  load(userId: string): Promise<CategoryVocabulary | null>;
}

export interface OnboardingCompletionPort {
  complete(userId: string): Promise<void>;
}
```

### Adapter

- `src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.ts`: implements `CategoryReaderPort`.
- Uses `SpreadsheetPortFactory` to create a provider-specific `SpreadsheetPort`, calls `getUniqueValues`, then normalizes whitespace, deduplicates case-insensitively, filters empty values, and returns sorted unique strings.
- `getUniqueValues` is implemented in `GoogleSheetsAdapter` and `ExcelOnlineAdapter`.

### Test suites

- `src/domain/value-objects/Category.spec.ts`
- `src/domain/value-objects/CategoryVocabulary.spec.ts`
- `src/domain/ports/categoryVocabulary.spec.ts`
- `src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.spec.ts`
- Updates to `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.spec.ts` and `src/infrastructure/adapters/sheets/ExcelOnlineAdapter.spec.ts` for `getUniqueValues`.

No DB migrations are needed for these three tasks; the existing `user_categories` table is reused later.

## Phases

### Phase 1: Domain model for category vocabulary (T-4.07-01)

Description: Create the domain value objects/entities that represent a category vocabulary, including state tracking, source tracking, and the default category set.

- [x] Create `src/domain/value-objects/Category.ts` with `name`, optional `displayLabel`, and `order`.
- [x] Create `src/domain/value-objects/CategoryVocabulary.ts` with state, source, and category list.
- [x] Define `DEFAULT_CATEGORY_SET` constant.
- [x] Implement helper methods: `confirm`, `withDefaultCategories`, `addCategory`, `removeCategory`, `renameCategory`.
- [x] Add `src/domain/value-objects/Category.spec.ts` covering construction and edge cases.
- [x] Add `src/domain/value-objects/CategoryVocabulary.spec.ts` covering state transitions, default set, and edit operations.
- [x] Update `src/domain/value-objects/index.ts` barrel if needed.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Application ports for category vocabulary persistence (T-4.07-02)

Description: Define the application-layer output ports required by the category confirmation flow, keeping them interface-only and free of infrastructure details.

- [x] Create `src/domain/ports/categoryVocabulary.ts` containing `CategoryReaderPort`, `CategoryVocabularyRepositoryPort`, and `OnboardingCompletionPort`.
- [x] Define `ReadUniqueCategoriesInput` DTO.
- [x] Add `src/domain/ports/categoryVocabulary.spec.ts` with contract smoke tests (type checks and mock implementations).
- [x] Update `src/domain/ports/index.ts` barrel if needed.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Spreadsheet unique category values reader (T-4.07-03)

Description: Implement the infrastructure adapter that reads the mapped category column, filters out empty cells and duplicates, normalizes whitespace, and returns sorted unique values.

- [x] Implement `getUniqueValues` in `GoogleSheetsAdapter` using Google Sheets API v4.
- [x] Implement `getUniqueValues` in `ExcelOnlineAdapter` using Microsoft Graph API.
- [x] Create `src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.ts` implementing `CategoryReaderPort`.
- [x] Add normalization logic: trim, collapse whitespace, case-insensitive deduplication, empty-value filtering, sorting.
- [x] Inject a Pino `Logger` into `SpreadsheetCategoryReader` for structured error logging.
- [x] Add `SpreadsheetCategoryReader.spec.ts` with mocked `SpreadsheetPortFactory`.
- [x] Update `GoogleSheetsAdapter.spec.ts` and `ExcelOnlineAdapter.spec.ts` to replace the "unimplemented" tests with real `getUniqueValues` tests.
- [x] Add tests for empty column returning `[]` instead of failing.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases of this plan are complete. Proceed to T-4.07-04 (natural-language category edit parser) to continue the HU-4.07 implementation.
