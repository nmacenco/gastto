# Subcategory hierarchy

## Purpose

Gastto detects, presents, modifies, and confirms linked category/subcategory relationships during `ONBOARDING_CATEGORIES`. The hierarchy is optional: spreadsheets without a confirmed `subcategoria` mapping continue through the flat category flow.

## Behavior (Implemented)

### Detection and capability activation

- A confirmed `categoria` mapping is always required.
- Hierarchy detection activates only when the same spreadsheet also has a confirmed `subcategoria` mapping.
- Category-only spreadsheets use the existing unique-category reader, default categories, and flat confirmation copy.
- Hierarchy-enabled spreadsheets use one row-preserving read with both mapped column indexes. Independent category and subcategory lists are never combined.
- Parents and parent/child pairs retain first-seen order. Names are trimmed and normalized for comparison.
- The same normalized child may exist under different parents, but duplicates under one parent are collapsed.
- A row with a category and no subcategory creates a category-only node.
- A subcategory without a category is excluded. Every excluded value is shown in an orphan warning and is never assigned an inferred or default parent.
- If no valid category is detected, Gastto offers `Alimentacion`, `Transporte`, `Servicios`, `Ocio`, `Salud`, and `Otros`, all without children.
- Repeated or interrupted detection merges active persisted vocabulary entries so manual additions and stable identifiers survive reconnection.

### Onboarding state compatibility

The canonical `ONBOARDING_CATEGORIES` payload is:

```json
{
  "categories": [
    {
      "name": "Food",
      "subcategories": ["Supermarket", "Restaurant"]
    },
    {
      "name": "Leisure",
      "subcategories": ["Restaurant"]
    }
  ],
  "orphanSubcategories": ["Streaming"],
  "subcategoryColumnMapped": true
}
```

Unrelated onboarding metadata, including `headerRowIndex`, is retained when this fragment is serialized.

Legacy payloads remain supported:

```json
{
  "categories": ["Food", "Leisure"]
}
```

A valid legacy payload is upgraded in memory to category nodes with no children, no orphans, and `subcategoryColumnMapped: false`. Malformed canonical nodes, child collections, or orphan values are rejected and trigger fresh detection.

### Presentation

- Hierarchy proposals show each category followed by its indented children.
- Orphan warnings are separate from the proposed hierarchy and name every excluded value.
- Telegram and WhatsApp pass the same canonical state to the same application services and use the same copy functions.

### Parent-aware modification

The deterministic Spanish/English parser supports one operation per message:

| Operation    | English example                            | Spanish example                              |
| ------------ | ------------------------------------------ | -------------------------------------------- |
| Add child    | `add Tolls to Transportation`              | `agregar Peajes a Transporte`                |
| Rename child | `under Food, rename Delivery to Takeout`   | `en Comida, renombra Delivery a Para llevar` |
| Move child   | `move Streaming from Utilities to Leisure` | `mueve Streaming de Servicios a Ocio`        |
| Remove child | `remove Cinema from Leisure`               | `quita Cine de Ocio`                         |

Existing category add, rename, and remove commands remain supported.

- Every child command must name its source or target parent explicitly.
- Parent lookup uses exact normalized names among active categories.
- Missing or ambiguous parents are rejected with the valid parent candidates.
- Missing children, duplicates within a parent, and move collisions are rejected without persistence.
- Accepted operations delegate duplicate, stable-ID, move, and branch-removal rules to `CategoryVocabulary`.
- Removing a category removes its complete active child branch from the aggregate.
- An accepted operation saves the complete aggregate transactionally and returns to `ONBOARDING_CATEGORIES` with the updated canonical proposal.

### Atomic confirmation

When a user confirms the proposal:

1. `ConfirmCategories` validates and normalizes the canonical or legacy payload.
2. It loads the active persisted aggregate and reconciles the complete reviewed proposal while preserving matching category and child identifiers.
3. It saves the complete hierarchy through `DrizzleCategoryVocabularyRepository`, which updates parents and children in one database transaction.
4. Only after that save succeeds, it writes `categories_confirmed_at` when absent.
5. It activates the user.
6. It transitions the FSM to `IDLE` with `statePayload` and `expiresAt` cleared.
7. It sends the completion message.

If hierarchy persistence fails, the transaction rolls back and confirmation, activation, the FSM, and completion messaging do not advance. Activation or FSM failures also suppress the completion message.

Re-confirmation always re-saves the reviewed hierarchy idempotently. It skips only an already-present confirmation timestamp and still restores the active user plus cleared `IDLE` state after interruption.

An absent, empty, or malformed proposal remains in `ONBOARDING_CATEGORIES`, clears the invalid payload, and prompts fresh detection. A missing spreadsheet configuration follows the existing account reconnection path.

## API / Interface

No HTTP route is added. The feature uses the existing `ONBOARDING_CATEGORIES` FSM state in the `process-message` BullMQ worker.

### Application contracts

- `DetectCategories.execute(input): Promise<{ categories, state, message }>` detects and persists a flat or linked proposal.
- `ModifyCategoryVocabulary.execute(input): Promise<{ categories, state, message }>` applies one category or parent-aware child operation.
- `ConfirmCategories.execute(input): Promise<{ nextState, message }>` atomically saves the reviewed hierarchy before onboarding finalization.
- `parseCategoryOnboardingState(payload)` validates canonical state and upgrades valid legacy state.
- `serializeCategoryOnboardingState(state, previousPayload)` writes canonical state while preserving unrelated metadata.

### Infrastructure contracts

- `SpreadsheetCategoryHierarchyReader.readHierarchy(...)` reads linked rows once through the active provider adapter.
- `ICategoryVocabularyRepository.findBySpreadsheetId(...)` loads active parents and their active children.
- `ICategoryVocabularyRepository.save(...)` reconciles and transactionally persists the complete aggregate using soft-disable semantics.

## Data Model

See [`docs/architecture/data-model.md`](../architecture/data-model.md).

- `user_categories` stores stable category identifiers and normalized names per spreadsheet.
- `user_subcategories` requires a category parent and scopes normalized-name uniqueness to that parent.
- Removed parents and children are soft-disabled during aggregate reconciliation.
- `conversation_states.state_payload` stores the transient canonical or legacy onboarding proposal.
- `spreadsheet_configs.categories_confirmed_at` is written only after the complete hierarchy save succeeds.

## Tests

- DTO tests cover canonical/legacy parsing, metadata preservation, malformed values, and deduplication.
- Detection tests cover category-only compatibility, row-preserving hierarchy reads, defaults, orphans, merges, provider failures, and repetition.
- Parser and modification tests cover every Spanish/English command, parent resolution, duplicates, collisions, branch removal, state preservation, and rejected-operation non-persistence.
- Confirmation tests cover hierarchical and legacy payloads, stable-ID reconciliation, strict finalization ordering, failure paths, reconnection, and re-confirmation.
- Worker tests cover interrupted detection, modification, canonical/legacy confirmation, invalid recovery, both channels, and the unchanged FSM state.
- PostgreSQL integration tests cover the production migration chain, atomic hierarchy persistence, orphan exclusion, same-name children under different parents, stable IDs, idempotency, reactivation, soft-disable, and induced transaction rollback.

## QA cases

- Confirm a category-only spreadsheet and verify no subcategory is required.
- Detect `Food | Restaurant` and `Leisure | Restaurant` and verify both relationships remain.
- Detect an orphan child and verify it appears only in the warning.
- Add, rename, move, and remove a child with explicit parents in both supported command languages.
- Retry missing-parent, ambiguous-parent, missing-child, duplicate, and collision commands and verify no partial change is saved.
- Confirm, reconnect, and confirm again; verify stable IDs, no duplicates, an active user, and a cleared `IDLE` state.
- Induce hierarchy persistence failure and verify no confirmation timestamp, activation, `IDLE` transition, or completion message.

## Related User Stories

- [`HU-4.08 - Configure linked categories and subcategories`](../user-stories/02-release-2-producto-complejo/02-epica-4/HU-4.08%20%E2%80%94%20Configure%20linked%20categories%20and%20subcategories.md)
- [`HU-4.07 - Confirm spreadsheet categories`](../user-stories/01-mvp/01-Vinculacion%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.07%20%E2%80%94%20Confirmar%20las%20categorias%20de%20la%20planilla.md)

## Notes

- No new FSM state, database migration, or HTTP endpoint is required.
- Category/subcategory vocabulary writes use soft-disable rather than destructive deletion.
