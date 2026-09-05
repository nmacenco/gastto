# Category confirmation

## Purpose

After column mapping, Gastto proposes the spreadsheet's active category vocabulary for review. Category-only spreadsheets retain the flat HU-4.07 behavior, while spreadsheets with a confirmed subcategory mapping use the linked hierarchy behavior documented in [`subcategory-hierarchy.md`](./subcategory-hierarchy.md).

## Behavior (Implemented)

### Shared onboarding routing

- Entering `ONBOARDING_CATEGORIES` immediately delegates to detection in the same worker job.
- An interrupted state with an absent, empty, or malformed proposal delegates to detection again.
- Confirmation intent has precedence over natural-language modification.
- No HTTP route or additional FSM state is used.
- Telegram and WhatsApp use the same payload and copy contracts.

### Retained flat category path

- When no confirmed `subcategoria` mapping exists, `DetectCategories` reads unique values from the `categoria` column beginning at `headerRowIndex + 1`, or row 2 when that metadata is absent.
- Values are trimmed, normalized, deduplicated, and empty cells are excluded.
- An empty category column produces the defaults `Alimentacion`, `Transporte`, `Servicios`, `Ocio`, `Salud`, and `Otros`.
- The user sees the existing flat confirmation prompt.
- Flat add, rename, and remove commands remain supported.
- Legacy `{ categories: string[] }` state payloads remain valid and are upgraded in memory without a database migration.

### Hierarchy-enabled path

- When both `categoria` and `subcategoria` mappings exist, `DetectCategories` consumes `SpreadsheetCategoryHierarchyReader` and reads linked rows once.
- The canonical proposal contains ordered category nodes, parent-scoped children, orphan warnings, and the mapping-capability flag.
- Parent-aware add, rename, move, and remove commands update the complete aggregate and return a nested proposal for re-confirmation.
- See [`subcategory-hierarchy.md`](./subcategory-hierarchy.md) for payloads, commands, invariants, and QA cases.

### Confirmation and failure behavior

- `ConfirmCategories` validates canonical or legacy state and requires at least one valid category.
- It reconciles the reviewed proposal with the active aggregate to preserve stable identifiers.
- It saves the complete aggregate transactionally before writing `categories_confirmed_at`, activating the user, clearing the FSM into `IDLE`, or sending completion.
- Orphan warning values are never persisted as vocabulary rows.
- Re-confirmation always re-saves the hierarchy idempotently, skips only a redundant timestamp write, and restores active/`IDLE` final-state invariants.
- A hierarchy save failure advances no finalization step and sends no completion.
- Activation or FSM transition failures also send no false completion.
- An invalid proposal remains in `ONBOARDING_CATEGORIES` with a cleared payload so detection can recover.
- A missing spreadsheet configuration follows the account reconnection path.

## API / Interface

No HTTP endpoint is exposed. The feature is driven by `ONBOARDING_CATEGORIES` in the `process-message` BullMQ worker.

### Application services

- `DetectCategories.execute(input): Promise<DetectCategoriesOutput>` detects and persists the flat or hierarchy proposal.
- `ModifyCategoryVocabulary.execute(input): Promise<ModifyCategoryVocabularyOutput>` applies flat or parent-aware changes and returns both canonical state and a flat compatibility projection.
- `ConfirmCategories.execute(input): Promise<ConfirmCategoriesOutput>` persists the complete reviewed aggregate before finalizing onboarding.

### Infrastructure

- `SpreadsheetCategoryReader.readCategories(...)` supports the retained flat path.
- `SpreadsheetCategoryHierarchyReader.readHierarchy(...)` supports the row-preserving linked path through Google or Microsoft spreadsheet adapters.
- `RegexCategoryModificationParser.parse(...)` recognizes deterministic Spanish/English category and parent-aware child commands.
- `DrizzleCategoryVocabularyRepository.save(...)` reconciles parents and children inside one transaction and soft-disables omitted rows.

## Data Model

See [`docs/architecture/data-model.md`](../architecture/data-model.md).

- `user_categories` stores active and soft-disabled category vocabulary rows.
- `user_subcategories` stores parent-scoped child rows with stable identifiers.
- `spreadsheet_configs.categories_confirmed_at` records successful finalization after hierarchy persistence.
- `conversation_states.state_payload` temporarily stores canonical or legacy proposals and is cleared on completion.

## Tests

- Detection tests cover flat compatibility and linked hierarchy behavior.
- Parser/modification tests cover flat and parent-aware commands plus rejection paths.
- Confirmation tests cover canonical/legacy reconciliation, ordering, idempotency, recovery, and failures.
- Worker tests cover detection, modification, confirmation, interrupted recovery, both channels, and the unchanged FSM.
- PostgreSQL integration tests cover atomic hierarchy persistence and rollback through the production migration chain.

## Related User Stories

- [`HU-4.07 - Confirm spreadsheet categories`](../user-stories/01-mvp/01-Vinculacion%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.07%20%E2%80%94%20Confirmar%20las%20categorias%20de%20la%20planilla.md)
- [`HU-4.08 - Configure linked categories and subcategories`](../user-stories/02-release-2-producto-complejo/02-epica-4/HU-4.08%20%E2%80%94%20Configure%20linked%20categories%20and%20subcategories.md)

## Notes

- `RegisterExpenseUseCase` consumes active vocabulary rows after onboarding.
- Linked hierarchy storage and soft-disable decisions are defined by ADR-022.
