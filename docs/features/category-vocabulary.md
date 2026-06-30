# Feature: Category vocabulary

## Purpose

Detect, normalize, and confirm the user's category vocabulary after the spreadsheet column mapping is accepted. The vocabulary drives later expense categorization and is the last onboarding step before the bot can record expenses.

## Behavior (Implemented)

- `Category` value object represents a single category with `name`, optional `displayLabel`, and `order`.
- `CategoryVocabulary` value object tracks the category list, state (`detecting`, `confirming`, `editing`, `confirmed`), and source (`detected`, `default`, `user-edited`).
- `DEFAULT_CATEGORY_SET` provides a fallback when the spreadsheet category column is empty.
- Domain helpers support confirming the vocabulary and editing it by adding, removing, or renaming categories.
- `CategoryReaderPort` defines reading unique category values from the mapped spreadsheet column.
- `CategoryVocabularyRepositoryPort` defines saving and loading the vocabulary with a TTL.
- `OnboardingCompletionPort` defines signaling the end of onboarding.
- `SpreadsheetCategoryReader` implements `CategoryReaderPort` using a provider-aware `SpreadsheetPortFactory`.
- `GoogleSheetsAdapter.getUniqueValues` and `ExcelOnlineAdapter.getUniqueValues` fetch all values from the mapped category column.
- The reader normalizes whitespace, deduplicates case-insensitively and accent-insensitively, filters empty cells, and returns sorted unique strings.
- Structured Pino logging is used for reader errors without leaking stack traces.

## Behavior (TODO)

- Natural-language category edit parser (T-4.07-04).
- Confirmation use case that persists the vocabulary and advances the FSM (T-4.07-05).
- User-facing copies for category confirmation and editing prompts.
- Redis-backed implementation of `CategoryVocabularyRepositoryPort`.
- Implementation of `OnboardingCompletionPort` that finalizes onboarding.

## API / Interface

### Domain value objects

- `Category.create(props: CategoryProps): Category`
- `CategoryVocabulary.create(props), fromDetected(values), withDefaults()`
- `CategoryVocabulary.confirm(), addCategory(name), removeCategory(name), renameCategory(from, to)`

### Ports

- `CategoryReaderPort.readUniqueCategories(input: ReadUniqueCategoriesInput): Promise<string[]>`
- `CategoryVocabularyRepositoryPort.save(userId, vocabulary, ttlSeconds): Promise<void>`
- `CategoryVocabularyRepositoryPort.load(userId): Promise<CategoryVocabulary | null>`
- `OnboardingCompletionPort.complete(userId): Promise<void>`

### Adapter

- `SpreadsheetCategoryReader` — implements `CategoryReaderPort`, injects `SpreadsheetPortFactory` and `Logger`.

## Data Model

- `user_categories` table stores confirmed user categories (see `docs/architecture/data-model.md`).
- Transient vocabulary during confirmation is persisted through `CategoryVocabularyRepositoryPort` (implementation TBD).

## Tests

- `src/domain/value-objects/Category.spec.ts`
- `src/domain/value-objects/CategoryVocabulary.spec.ts`
- `src/domain/ports/categoryVocabulary.spec.ts`
- `src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.spec.ts`
- `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.spec.ts`
- `src/infrastructure/adapters/sheets/ExcelOnlineAdapter.spec.ts`

## Related User Stories

- [`HU-4.07 — Confirm spreadsheet categories`](../user-stories/01-mvp/01-Vinculaci%C3%B3n%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.07-confirm-spreadsheet-categories/HU-4.07%20%E2%80%94%20Confirm%20spreadsheet%20categories.md)

## Notes

- `SpreadsheetPortFactory` was made provider-aware so the same factory can create either a `GoogleSheetsAdapter` or `ExcelOnlineAdapter` based on the user's linked provider.
- Deduplication preserves the first occurrence's casing and removes accents only for comparison.
