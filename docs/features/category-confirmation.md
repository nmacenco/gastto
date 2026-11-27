# Category confirmation

## Settings destination changes

`SETTINGS_CATEGORIES` reads the candidate sheet using its reviewed `categoria` column and optional `subcategoria` column. It keeps the flat or linked hierarchy in the guarded conversation payload, scoped to the candidate flow and proposal. The user confirms with `confirmar` or replaces the reviewed list with `categorías: Nombre; Otra > Subcategoría`. Category confirmation advances to a payment-method review. Final payment confirmation persists the new version's hierarchy, payment catalog, mapping, and configuration activation in one transaction. Cancellation, expiry, and failed activation leave the previous hierarchy unchanged.

## Purpose

After column mapping, Gastto proposes the spreadsheet's active category vocabulary for review. Category-only spreadsheets retain the flat HU-4.07 behavior, while spreadsheets with a confirmed subcategory mapping use the linked hierarchy behavior documented in [`subcategory-hierarchy.md`](./subcategory-hierarchy.md).

## Behavior (Implemented)

### Shared onboarding routing

- Entering `ONBOARDING_CATEGORIES` immediately delegates to detection in the same worker job.
- An interrupted state with an absent, empty, or malformed proposal delegates to detection again.
- Confirmation intent has precedence over natural-language modification.
- The exact `confirmar` command shown in the onboarding prompts follows that confirmation path in both category and payment review; existing confirmation aliases still work.
- No HTTP route or additional FSM state is used.
- Telegram and WhatsApp use the same payload and copy contracts.
- An explicit `cancelar`, `salir`, `cancel`, or `exit` command leaves onboarding category or payment review before detection, confirmation, or modification runs. It clears the conversation draft; an incomplete destination cannot be used for expenses.

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
- After onboarding, expense hierarchy presentation/classification remains enabled by either a confirmed `subcategoria` mapping or active configured children. Spreadsheet child writes still require the mapping, so category-only row layouts remain unchanged.

### Confirmation and failure behavior

- `ConfirmCategories` validates canonical or legacy state and requires at least one valid category.
- It detects payment values after category confirmation and keeps both reviewed vocabularies in the guarded conversation payload.
- Final payment confirmation reconciles identified category drafts and commits both vocabularies, confirmation markers, user activation, and `IDLE` together in one database transaction.
- Orphan warning values are never persisted as vocabulary rows.
- A repeated final confirmation is guarded by the conversation revision; legacy in-flight category payloads are re-presented or re-detected before a new confirmation can enter payment review.
- A catalog commit failure advances no finalization step and sends no completion.
- Activation or FSM transition failures also send no false completion.
- An invalid proposal remains in `ONBOARDING_CATEGORIES` with a cleared payload so detection can recover.
- A missing spreadsheet configuration follows the account reconnection path.

## API / Interface

No HTTP endpoint is exposed. The feature is driven by `ONBOARDING_CATEGORIES` in the `process-message` BullMQ worker.

### Application services

- `DetectCategories.execute(input): Promise<DetectCategoriesOutput>` detects the flat or hierarchy proposal and stores its identified draft in conversation state.
- `ModifyCategoryVocabulary.execute(input): Promise<ModifyCategoryVocabularyOutput>` applies flat or parent-aware changes and returns both canonical state and a flat compatibility projection.
- `ConfirmCategories.execute(input): Promise<ConfirmCategoriesOutput>` advances category review to payment review, then calls the atomic onboarding commit.

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
- Worker tests cover detection, modification, confirmation, interrupted recovery, both channels, and guarded mapping recovery.
- PostgreSQL integration tests cover atomic hierarchy persistence and rollback through the production migration chain.

## Related User Stories

- [`HU-4.07 - Confirm spreadsheet categories`](../user-stories/01-mvp/01-Vinculacion%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.07%20%E2%80%94%20Confirmar%20las%20categorias%20de%20la%20planilla.md)
- [`HU-4.08 - Configure linked categories and subcategories`](../user-stories/02-release-2-producto-complejo/02-epica-4/HU-4.08%20%E2%80%94%20Configure%20linked%20categories%20and%20subcategories.md)

## Notes

- `RegisterExpenseUseCase` consumes active vocabulary rows after onboarding.
- Confirmed hierarchy capability does not make a child mandatory and does not change category-only spreadsheet row shape.
- Linked hierarchy storage and soft-disable decisions are defined by ADR-022.

## Recovery guidance (2026-11-15)

Hierarchy errors and category rename/removal re-prompts retain the draft and include an explicit cancellation instruction. Existing category/payment confirmation and transactional activation remain unchanged.

## Setup message formatting (2026-11-16)

Hierarchy error prompts preserve parent/child indentation and separate the correction instruction, current hierarchy, orphan warnings, and cancellation footer. Existing structured confirmation summaries remain concise. Payment review after category confirmation uses one line per edit option and a separate local-only storage warning. See [conversational message formatting](./conversational-message-formatting.md).

## Confirmed mapping context and recovery (2026-11-24)

Mapping confirmation now retains `spreadsheetId`, `proposalId`, provider, file, sheet, effective header row, and `confirmedMappings`. Each snapshot entry contains `gasttoField`, zero-based `columnIndex`, `columnHeader`, and the confirmation timestamp as an ISO string. Category draft serialization and manual edits retain this metadata; payment review retains it too. Detection and confirmation validate the active configuration owner/destination and compare all captured mappings, including deliberately absent optional fields, with repository rows. Changed rows, confirmation timestamps, or header offsets require mapping review. A stale proposal supplied to a newer observed execution is rejected. Existing revision/CAS and expiry checks apply to draft and recovery transitions.

`DetectCategoriesOutput` is a discriminated union: `{ kind: 'proposal', categories, state, message }` or `{ kind: 'recovery', nextState, message }`. Recovery exposes no category state. Missing configuration or authorization follows `ONBOARDING_START` reconnection. Missing category mapping or inconsistent captured context transitions to `ONBOARDING_MAPPING`, clears the category/payment draft, and asks the user to write `revisar` to generate a fresh column proposal, with a separate cancellation option. The next message generates that proposal; it cannot confirm old mappings in the same turn. No payment detection or activation occurs during recovery.

Defaults are offered visibly only after a successful category read with no usable categories. Linked C/D reads continue to use the same rows and the effective header offset. An intentionally unmapped payment column still permits local storage; loss of a captured payment column requires recovery before either payment review or final confirmation. Structured injected Pino diagnostics record the use case, reason code, configuration/proposal IDs and user ID, without cell contents or conversational payloads.

Legacy drafts without `confirmedMappings` must be rebound to confirmed repository mappings or re-detected before acceptance, as described below.

## Successful presentation before acceptance (2026-11-24)

A saved category list alone cannot authorize confirmation. `PresentCategoryProposal` writes a new `categoryProposalId` with null `categoryPresentation` and `categoryAcceptance`, sends the full current vocabulary, then records evidence only when the messaging adapter returns `status: success`. The evidence update uses the revision returned by the draft write and retains the observed deadline; a stale or expired write fails. A thrown send error or returned failure leaves the draft unpresented. Adapter success does not prove that a person read the message.

The presentation fingerprint binds the normalized hierarchy, orphan warnings, mapping capability, stable draft IDs, destination, header and confirmed mapping snapshot. JSONB object key order does not affect it. Category edits generate a new proposal and repeat the delivery lifecycle, so old evidence cannot authorize an edited hierarchy. Serialization also clears evidence if the hierarchy changes.

`ConfirmCategories.execute` enforces eligibility directly for both normal onboarding and the compatibility finalization path. A reply such as `ok`, `sí`, or `confirmar` to an unpresented or mismatched draft shows the proposal again and waits for a new reply. It does not detect payments, persist live catalogs or activate the user during that re-presentation. A subsequent eligible category confirmation records `categoryAcceptance` while entering payment review. Payment edits preserve this evidence; final confirmation requires it to match the current category proposal. The atomic commit rechecks acceptance and the confirmed destination/mappings under the transaction locks before writing either catalog.

An equivalent legacy draft with a matching destination can be rebound to confirmed repository mappings and re-presented, preserving its vocabulary and identified category/child IDs. Missing context is re-detected through `DetectCategories`; missing prerequisites follow typed recovery. The old flat default set without an identified draft is treated as potentially placeholder-generated and read again from the real category/subcategory columns, even if an old `paymentReview` flag exists. Re-presentation and re-detection clear the old payment review; a fresh reply is required before payment detection. Unrelated onboarding metadata is retained. Cancellation clears the entire draft before any acceptance.

Unit/worker regressions cover returned delivery failure, thrown errors, interruption before evidence, stale CAS, changed hierarchy, the confirmation aliases and the guarded compatibility path. Disposable PostgreSQL/Redis regressions cover complete deletion and registration of the same chat with a new account/configuration identity, credential and Redis cleanup, ordered C/D hierarchy and A payment proposals, atomic finalization, legacy recovery, interruption and cancellation. These regressions reproduce and fix the placeholder/premature-acceptance paths; the original cause of mapping disappearance remains unproven.
