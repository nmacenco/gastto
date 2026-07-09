# Plan — Confirm spreadsheet categories (HU-4.07, tasks T-4.07-04, T-4.07-05, T-4.07-06)

## Goal

Complete the category confirmation onboarding flow so that after column mapping is confirmed:
1. the system detects and persists the user's spreadsheet category vocabulary (T-4.07-04);
2. the user can confirm it to finish onboarding (T-4.07-05);
3. the user can add or rename categories via natural language and the updated vocabulary is persisted (T-4.07-06).

## Context

- `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.07-confirm-spreadsheet-categories/HU-4.07 — Confirm spreadsheet categories.md`
- `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.07-confirm-spreadsheet-categories/tasks/T-4.07-04.md`
- `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.07-confirm-spreadsheet-categories/tasks/T-4.07-05.md`
- `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.07-confirm-spreadsheet-categories/tasks/T-4.07-06.md`
- `docs/features/category-confirmation.md`
- `docs/adr/adr.md`
- `docs/testing/guidelines.md`
- `src/domain/entities/CategoryVocabulary.ts`
- `src/domain/entities/Category.ts`
- `src/domain/ports/categoryReader.ts`
- `src/domain/ports/repositories.ts`
- `src/infrastructure/db/schema/index.ts`
- `src/infrastructure/db/repositories/DrizzleCategoryVocabularyRepository.ts`
- `src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.ts`
- `src/application/use-cases/spreadsheet/DetectCategories.ts`
- `src/application/use-cases/spreadsheet/DetectCategories.spec.ts`
- `src/interfaces/workers/message.worker.ts`
- `src/interfaces/workers/message.worker.spec.ts`
- `src/application/utils/intents.ts`
- `src/application/copies/onboarding.copies.ts`

## Phases

### Phase 1 — Complete DetectCategories (T-4.07-04)

**Description:** The current `DetectCategories` use case already reads categories from the spreadsheet and sends a confirmation prompt, but it never persists them to `user_categories`, and it does not return a presentation DTO. Additionally, the message worker calls `DetectCategories` on every message while in `ONBOARDING_CATEGORIES`, which would re-read the spreadsheet every time the user replies. We fix both issues in this phase.

- [x] Add `categoryVocabularyRepository: ICategoryVocabularyRepository` to `DetectCategoriesDeps`.
- [x] Inside `DetectCategories.execute`, after reading the categories (or falling back to defaults), build a `CategoryVocabulary` aggregate and call `this.deps.categoryVocabularyRepository.save(vocabulary)`.
- [x] Change `execute` return type from `Promise<void>` to `Promise<{ categories: string[]; message: string }>` so the caller can decide whether to send the message (worker) or just use the data.
- [x] Update `DetectCategories.spec.ts` to assert that `save` is called with the correct vocabulary for both populated-column and empty-column paths.
- [x] In `message.worker.ts`, update the `ONBOARDING_CATEGORIES` branch so it only calls `DetectCategories` when `categories` are **not** already present in the FSM payload (first entry). When the payload already contains categories (user is replying), skip detection and re-send the confirmation prompt.
- [x] Update `message.worker.spec.ts` to cover the two sub-branches of `ONBOARDING_CATEGORIES`: first entry (delegates to `DetectCategories`) and subsequent reply (does not call `DetectCategories` again).
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2 — Confirm categories and close onboarding (T-4.07-05)

**Description:** Create the use case that finalizes the category vocabulary when the user replies with a confirmation intent. It marks the vocabulary as confirmed, transitions the user status to `active`, moves the FSM to `IDLE`, and sends the final welcome message.

- [x] Add `categoriesConfirmedAt: timestamp('categories_confirmed_at')` to `spreadsheet_configs` schema in `src/infrastructure/db/schema/index.ts` (nullable).
- [x] Add `updateCategoriesConfirmed(id: string): Promise<void>` to `ISpreadsheetConfigRepository`.
- [x] Implement `updateCategoriesConfirmed` in `DrizzleSpreadsheetConfigRepository`.
- [x] Generate and apply a new Drizzle migration with `pnpm db:generate`.
- [x] Update `docs/architecture/data-model.md` with the new column and its purpose.
- [x] Create `ConfirmCategories` use case under `src/application/use-cases/spreadsheet/ConfirmCategories.ts`.
- [x] Create `ConfirmCategories.spec.ts` with unit tests covering: happy path, missing config, idempotent re-confirmation.
- [x] Add the final welcome message copy to `onboardingCopies.onboardingComplete()`.
- [x] Wire `ConfirmCategories` into `message.worker.ts` under the `ONBOARDING_CATEGORIES` reply branch.
- [x] Update `message.worker.spec.ts` to cover the confirmation reply branch.
- [x] Update `docs/features/category-confirmation.md` to mark the confirmation behavior as implemented.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3 — Add and correct categories via natural language (T-4.07-06)

**Description:** Build the use case that interprets natural-language instructions to add missing categories or rename existing ones in the user's vocabulary. The use case uses a lightweight rule-based parser (Spanish + English) to extract intents, updates the `CategoryVocabulary` aggregate, persists changes, and returns the updated list for re-confirmation.

- [ ] Define a new domain port `CategoryModificationParserPort` under `src/domain/ports/`:
  - `parse(input: string): Promise<CategoryModificationIntent>`
  - `CategoryModificationIntent` can be `AddCategory(name: string)` or `RenameCategory(from: string, to: string)` or `Unknown`.
- [ ] Create `RegexCategoryModificationParser` implementation under `src/infrastructure/adapters/` (lightweight, no LLM dependency for MVP):
  - "falta Salud", "add Education" -> `AddCategory`
  - "Ocio se llama Entretenimiento", "Leisure is actually Entertainment" -> `RenameCategory`
  - Handle Spanish and English variants.
- [ ] Create `RegexCategoryModificationParser.spec.ts` with at least 6 distinct natural-language variations in Spanish and English.
- [ ] Create `ModifyCategoryVocabulary` use case under `src/application/use-cases/spreadsheet/ModifyCategoryVocabulary.ts`:
  - Accepts `userId`, `externalId`, `channel`, `rawMessage`, `statePayload`.
  - Delegates intent parsing to `CategoryModificationParserPort`.
  - Loads `CategoryVocabulary` via `ICategoryVocabularyRepository`.
  - If `AddCategory`, calls `vocabulary.addCategory(name)`.
  - If `RenameCategory`, finds the category by normalized name and calls `vocabulary.renameCategory(id, newName)`.
  - Persists updated vocabulary.
  - Returns DTO `{ categories: string[]; message: string }` with the updated list for re-confirmation.
- [ ] Create `ModifyCategoryVocabulary.spec.ts` with unit tests covering add, rename, unknown intent, and duplicate name rejection.
- [ ] Add updated re-confirmation copy to `onboardingCopies.categoryUpdatedPrompt(categories: string[])`.
- [ ] Wire `ModifyCategoryVocabulary` into `message.worker.ts` under the `ONBOARDING_CATEGORIES` reply branch for non-confirm messages.
- [ ] Update `message.worker.spec.ts` to cover the add/correct reply branch.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Implement Phase 3 (Add and correct categories via natural language) to build the `ModifyCategoryVocabulary` use case and the `RegexCategoryModificationParser`.
