# Category confirmation

## Purpose

After the user confirms the column mapping, Gastto reads the values already present in the category column and presents them as the user's category vocabulary. The user can then confirm, add, or correct categories before the onboarding flow completes.

## Behavior (Implemented)

- When the FSM enters `ONBOARDING_CATEGORIES`, the worker delegates to `DetectCategories`.
- `DetectCategories` loads the active spreadsheet config and the decrypted OAuth token.
- It finds the column mapping for the `categoria` Gastto field.
- It reads unique values from that column starting at row 2 (skipping the header) through `SpreadsheetCategoryReader`.
- Values are normalized (trimmed and lowercased), deduplicated, and empty cells are filtered out.
- If no categories are found, a default set is used: `Alimentacion`, `Transporte`, `Servicios`, `Ocio`, `Salud`, `Otros`.
- A confirmation prompt is sent to the user and the FSM payload stores the detected/default categories.
- When the user replies with a confirmation intent ("sí", "yes", etc.), `ConfirmCategories` marks the vocabulary as confirmed in `spreadsheet_configs.categories_confirmed_at`, transitions the user status to `active`, moves the FSM to `IDLE`, and sends the final welcome message.
- Re-confirmation is idempotent: if `categories_confirmed_at` is already set, the use case returns success without error.

## Behavior (Implemented)

- Natural-language commands to add a missing category (e.g. "falta Salud").
- Natural-language commands to rename a category (e.g. "Ocio se llama Entretenimiento").
- Handle re-onboarding by merging previously persisted categories with newly detected ones.

See [`docs/user-stories/01-mvp/01-Vinculacion de planilla · Release 1 MVP/HU-4.07 — Confirmar las categorias de la planilla.md`](../user-stories/01-mvp/01-Vinculacion%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.07%20%E2%80%94%20Confirmar%20las%20categorias%20de%20la%20planilla.md).

## API / Interface

No HTTP endpoints. The feature is triggered by the `ONBOARDING_CATEGORIES` FSM state inside the `process-message` BullMQ worker.

### Application services

- `DetectCategories.execute(input: DetectCategoriesInput): Promise<DetectCategoriesOutput>` — orchestrates token retrieval, column lookup, category reading, vocabulary persistence, and user messaging.
- `ConfirmCategories.execute(input: ConfirmCategoriesInput): Promise<ConfirmCategoriesOutput>` — marks vocabulary confirmed, activates user, transitions FSM to `IDLE`, and sends welcome message.
- `ModifyCategoryVocabulary.execute(input: ModifyCategoryVocabularyInput): Promise<ModifyCategoryVocabularyOutput>` — parses natural-language add/rename instructions, updates the persisted vocabulary, and returns the updated list for re-confirmation.

### Infrastructure

- `SpreadsheetCategoryReader.readCategories(fileId, columnIndex, sheetName): Promise<string[]>` — reads and normalizes category values from a spreadsheet column.
- `SpreadsheetPort.getUniqueValues(fileId, columnIndex, sheetName): Promise<string[]>` — adapter-level method that returns deduplicated non-empty values from a column, skipping the header row.
- `RegexCategoryModificationParser.parse(input: string): Promise<CategoryModificationIntent>` — lightweight rule-based parser supporting Spanish and English add/rename patterns.
- `DrizzleCategoryVocabularyRepository` — persists `CategoryVocabulary` aggregates to `user_categories` with soft-delete of removed categories and upsert of new ones.

## Data Model

- `expense_records` — not directly used by this feature.
- `user_categories` — stores the confirmed vocabulary per spreadsheet. New categories are inserted; removed ones are soft-deleted (`isActive = false`).
- `spreadsheet_configs` — provides `fileId`, `sheetName`, and `provider`. Also tracks `categoriesConfirmedAt`.
- `column_mappings` — provides the index of the category column for the active spreadsheet.

## Tests

- `src/application/use-cases/spreadsheet/DetectCategories.spec.ts` — covers detection, default fallback, missing-config path, and vocabulary persistence.
- `src/application/use-cases/spreadsheet/ConfirmCategories.spec.ts` — covers happy path, idempotent re-confirmation, and missing-config fallback.
- `src/application/use-cases/spreadsheet/ModifyCategoryVocabulary.spec.ts` — covers add, rename, unknown intent, duplicate rejection, missing config, and missing rename target.
- `src/infrastructure/adapters/RegexCategoryModificationParser.spec.ts` — covers Spanish and English add/rename/unknown patterns with normalization.
- `src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.spec.ts` — covers normalization, deduplication, and empty filtering.
- `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.spec.ts` — covers `getUniqueValues` header skip and error handling.
- `src/infrastructure/adapters/sheets/ExcelOnlineAdapter.spec.ts` — covers `getUniqueValues` header skip and error handling.
- `src/interfaces/workers/message.worker.spec.ts` — covers `ONBOARDING_CATEGORIES` delegation to DetectCategories, ConfirmCategories, ModifyCategoryVocabulary, and fallback branches.

## Related User Stories

- `docs/user-stories/01-mvp/01-Vinculacion de planilla · Release 1 MVP/HU-4.07 — Confirmar las categorias de la planilla.md`

## Notes

- `RegisterExpenseUseCase` already reads active categories from `user_categories`, so completing the confirmation persistence will immediately improve category resolution.
- The current `DetectCategories` use case sends the prompt and stores categories in the FSM payload, but does not yet wait for or process the user's response.
