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

### Parent-first expense classification and review

- Expense interpretation receives ordered active parents and their active children as untrusted hierarchy data. The explicit `subcategoryEnabled` capability is true when the spreadsheet has a confirmed `subcategoria` mapping or its active vocabulary contains configured children.
- The deterministic classifier resolves the active category first and binds it to its stable persisted ID. It evaluates exact, message-phrase, and conservative fallback child matches only against that selected parent's active children.
- Equal normalized child names under different parents remain isolated. An unresolved parent never produces a child, and a valid parent is preserved when no child has sufficient textual evidence.
- The hierarchical result contains independent category and subcategory selections with stable IDs, names, statuses, and confidence. A missing child uses null identifiers/names plus `none`/`nula` and never triggers automatic selection merely because the parent has one child.
- New `EXPENSE_REVIEW` payloads explicitly retain nullable child IDs/names, child status, and the capability flag. Hierarchy-enabled Telegram reviews show the child or an explicit `❓ Sin subcategoría`; disabled and legacy reviews keep the five-field category-only output.
- Category and subcategory corrections are resolved as one parent-aware selection. Combined changes are atomic, child-only changes remain scoped to the current active parent, and category-only changes clear a child whose stable ID no longer belongs to the resolved parent.
- Invalid or inactive children produce typed parent-specific guidance and leave the complete persisted review, correction count, timeout, high-amount flag, queue count, and undo metadata unchanged.

### Conversational payload compatibility

- Shared domain normalizers validate every existing extraction and review field. Legacy payloads missing hierarchy fields are upgraded in memory to explicit `subcategoriaRaw: null`, `confianzaSubcategoria: nula`, null child name/ID, `subcategoryStatus: none`, and `subcategoryEnabled: false`.
- Explicit canonical values are preserved. Contradictory selections are rejected: a child requires a resolved parent plus non-null stable child ID/name, disabled hierarchy cannot expose a child, and no-child selections use canonical empty values.
- `ExpenseCorrectionState` and `ExpenseClarificationState` normalize on creation and deserialization and always serialize canonical hierarchy fields while retaining cycle, high-amount, queue-count, and type-marker behavior.
- Retry envelopes validate and normalize their nested reviewed expense before replay. Invalid or expired retries return safely to `IDLE`; valid retries reuse reviewed data without NLP.
- The worker uses the shared review parser for text and callback confirmation/cancellation/correction, immediate undo re-presentation, and other review routing. Invalid payloads are logged with structured context, reset safely, and never reach application use cases through casts.
- Queue storage remains a FIFO of raw message items with the existing capacity rules. Canonical clarification or review payloads are produced only after dequeue through normal registration.

### Phase 5 persistence boundary

Master-plan Phase 5 ends after classification and review presentation. It does not change spreadsheet row construction, local expense persistence, retry, queue, cancellation, or undo semantics. Spreadsheet writes and local category/subcategory ID plus snapshot persistence remain deferred to the master plan's Phase 7 persistence and release subplan.

The natural-language correction compatibility phase keeps this boundary unchanged: normalization and correction do not add spreadsheet columns, persist hierarchy IDs/snapshots, consume them during save, or replay NLP during retries.

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
- During expense review, it also stores nullable stable category/subcategory selections and the hierarchy capability. Missing hierarchy fields continue to mean a legacy category-only review.
- `spreadsheet_configs.categories_confirmed_at` is written only after the complete hierarchy save succeeds.

## Tests

- DTO tests cover canonical/legacy parsing, metadata preservation, malformed values, and deduplication.
- Detection tests cover category-only compatibility, row-preserving hierarchy reads, defaults, orphans, merges, provider failures, and repetition.
- Parser and modification tests cover every Spanish/English command, parent resolution, duplicates, collisions, branch removal, state preservation, and rejected-operation non-persistence.
- Confirmation tests cover hierarchical and legacy payloads, stable-ID reconciliation, strict finalization ordering, failure paths, reconnection, and re-confirmation.
- Worker tests cover interrupted detection, modification, canonical/legacy confirmation, invalid recovery, both channels, and the unchanged FSM state.
- Classification and review tests cover stable IDs, active-parent isolation, equal child names under different parents, absent children, independent status/confidence, enabled presentation, and legacy category-only output.
- Correction and compatibility tests cover atomic combined changes, scoped child-only changes, invalid-child non-mutation, canonical/legacy state round trips, clarification completion, queue progression, retry without NLP, timeout recovery, and malformed-state reset.
- PostgreSQL integration tests cover the production migration chain, atomic hierarchy persistence, orphan exclusion, same-name children under different parents, stable IDs, idempotency, reactivation, soft-disable, and induced transaction rollback.

## QA cases

- Confirm a category-only spreadsheet and verify no subcategory is required.
- Detect `Food | Restaurant` and `Leisure | Restaurant` and verify both relationships remain.
- Detect an orphan child and verify it appears only in the warning.
- Add, rename, move, and remove a child with explicit parents in both supported command languages.
- Retry missing-parent, ambiguous-parent, missing-child, duplicate, and collision commands and verify no partial change is saved.
- Confirm, reconnect, and confirm again; verify stable IDs, no duplicates, an active user, and a cleared `IDLE` state.
- Induce hierarchy persistence failure and verify no confirmation timestamp, activation, `IDLE` transition, or completion message.
- Review an expense with a mapped subcategory column and verify the selected child appears directly below its parent with its own marker.
- Review a valid category without a child and verify `❓ Sin subcategoría` can still be confirmed.
- Review a legacy payload or a category-only user and verify no subcategory row appears.
- Correct both parent and child, then try a child from another parent and verify the second attempt changes no persisted review field.
- Resume legacy clarification, review, correction, and retry payloads and verify they continue with canonical no-child values and no extra NLP on retry.

## Related User Stories

- [`HU-4.08 - Configure linked categories and subcategories`](../user-stories/02-release-2-producto-complejo/02-epica-4/HU-4.08%20%E2%80%94%20Configure%20linked%20categories%20and%20subcategories.md)
- [`HU-4.07 - Confirm spreadsheet categories`](../user-stories/01-mvp/01-Vinculacion%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.07%20%E2%80%94%20Confirmar%20las%20categorias%20de%20la%20planilla.md)
- [`E1-US-18 - Classify and register linked subcategories`](../user-stories/02-release-2-producto-complejo/01-epica-1/E1-US-18%20%E2%80%94%20Classify%20and%20register%20linked%20subcategories.md)

## Notes

- No new FSM state, database migration, or HTTP endpoint is required.
- Category/subcategory vocabulary writes use soft-disable rather than destructive deletion.
- Review-time stable identifiers are not yet consumed by spreadsheet or local expense persistence in this phase.
