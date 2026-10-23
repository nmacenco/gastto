# Category vocabulary foundation

## Purpose

The `main` branch introduced standalone category vocabulary primitives for HU-4.07. They remain in the merged tree, but the live onboarding and expense flows use the later category aggregate and ports documented in [Category confirmation](./category-confirmation.md) and [Subcategory hierarchy](./subcategory-hierarchy.md).

## Standalone components

- `src/domain/value-objects/Category.ts` and `CategoryVocabulary.ts` model a flat list with detection, confirmation, add, remove, and rename operations. Their default names are in English.
- `src/domain/ports/categoryVocabulary.ts` defines reader, temporary repository, and onboarding completion contracts. No production use case is wired to these contracts.
- `src/infrastructure/adapters/sheets/SpreadsheetPortAdapterFactory.ts` can create a Google Sheets or Excel Online adapter from a provider and access token. The active bootstrap uses the provider-specific factories and the `SpreadsheetPortFactory` token-only contract.

## Active behavior

`DetectCategories`, `ModifyCategoryVocabulary`, and `ConfirmCategories` use the aggregate in `src/domain/entities/CategoryVocabulary.ts`. The active spreadsheet reader exposes `readCategories` through `ICategoryReaderPort` and starts after the detected header row. Confirmation persists the complete aggregate before onboarding finishes. See [Category confirmation](./category-confirmation.md) for the user-visible rules, failure behavior, and tests.

## Tests

- `src/domain/value-objects/Category.spec.ts`
- `src/domain/value-objects/CategoryVocabulary.spec.ts`
- `src/domain/ports/categoryVocabulary.spec.ts`
