# Chat Category, Subcategory, and Payment Method Settings

## Goal

Let users edit categories, linked subcategories, and payment methods from chat without changing their spreadsheet destination. Integrate configured payment methods into expense interpretation, review, correction, and saving while preserving historical records and cancellation safety.

## Context

The current implementation provides:

- A settings menu with connection status, reauthorization, file selection, and sheet selection.
- Category and subcategory editing during onboarding, plus vocabulary review when changing destinations.
- Stable category/subcategory identifiers and immutable expense text snapshots.
- Optional payment method extraction and persistence as free text.
- Expense confirmation protected by conversation ownership, review revisions, and financial execution claims.

Important implementation findings:

- `ModifyCategoryVocabulary` immediately persists each operation. Settings drafts must reuse domain rules and parsing without invoking this persistence behavior.
- `DrizzleCategoryVocabularyRepository` prioritizes natural-key matches over supplied identifiers. Renaming or moving into an inactive entry's name can therefore change identity unexpectedly.
- Destination activation creates a new configuration and vocabulary. Direct vocabulary editing must preserve the existing configuration and identifiers.
- Payment methods are currently absent from the expense summary and correction contract.
- Expense clarification, retry, queue, and correction share persisted payload normalizers. Payment selection must survive all these boundaries.
- Some documentation describes older contracts; inspected source is authoritative.

Implementation anchors:

- [Category aggregate](../../../src/domain/entities/CategoryVocabulary.ts), category parser, vocabulary repository, and onboarding use cases.
- [Settings destination flow](../../../src/application/use-cases/spreadsheet/SettingsDestinationFlow.ts), configuration activation, message worker, and dependency wiring.
- [Expense registration](../../../src/application/use-cases/expense/RegisterExpense.ts), correction, summary generation, confirmation authorization, retry, and expense repositories.

Required references:

- [Chat settings](../../../docs/features/chat-spreadsheet-settings.md), [subcategory hierarchy](../../../docs/features/subcategory-hierarchy.md), and [expense correction](../../../docs/features/expense-correction.md).
- [Expense confirmation](../../../docs/features/expense-confirmation.md), [conversation state management](../../../docs/features/conversation-state-management.md), and [data model](../../../docs/architecture/data-model.md).
- [ADRs](../../../docs/adr/adr.md), [stable hierarchy references](../../../docs/adr/ADR-022-linked-subcategory-hierarchy.md), and [testing guidelines](../../../docs/testing/guidelines.md).

### Agreed behavior

- Deliver three independently usable phases.
- Categories and subcategories remain one hierarchy. A category may have no children; a subcategory requires one parent.
- Payment methods form an independent, flat catalog scoped to the active spreadsheet configuration.
- Settings edits remain drafts until explicit confirmation. Cancellation and expiry discard the draft.
- Renaming and moving preserve identifiers. Removing entries means deactivation.
- Historical expense snapshots and spreadsheet rows remain unchanged.
- Existing configurations retain free-text payment behavior until their catalog is confirmed. A confirmed empty catalog is distinct from an unconfigured catalog.
- With a configured catalog, an unknown payment requires choosing an existing option, explicitly adding it, or clearing the payment before saving.
- Explicitly adding a payment during expense review persists that catalog entry even if the expense is subsequently cancelled.
- New destinations propose payment methods detected from their mapped column for review. They do not automatically inherit the old destination's catalog.
- Missing payment or subcategory columns do not prevent local configuration. Chat explains that unmapped values are retained locally.
- Spreadsheet dropdown definitions, historical rewrites, accounts, balances, aliases, and automatic provider validation-rule changes are outside this delivery.

## Phases

### Phase 1: Edit categories and subcategories directly from settings

**Description:** Add menu option `5. Categorías y subcategorías`, with an editable draft, explicit confirmation, and transactional persistence.

**Contracts**

- `SettingsVocabularyFlow.start({ state, externalId, kind }): Promise<void>` opens the current catalog as a draft. Initially, `kind` supports `categories`.
- `SettingsVocabularyFlow.reply({ state, externalId, rawMessage }): Promise<void>` parses commands, updates the owned draft, renders guidance, or commits.
- `SettingsVocabularyCommit.execute({ userId, expected, flowId, sourceConfigId, baseline, draft }): Promise<'committed' | 'stale' | 'conflict'>` validates ownership and persists the catalog and conversation exit atomically.
- The settings payload becomes a validated discriminated union with `screen: 'menu' | 'categories'`. Drafts retain category IDs, child IDs, parent IDs, and the baseline catalog.
- Continue using `SETTINGS_MENU` for these screens. Legacy payloads containing only `flowId` normalize to the menu screen.

**To-do**

- [x] Add the new option, draft rendering, operation examples, and confirmation/cancellation copy. Route draft replies before ordinary menu-number handling.
- [x] Load the active configuration and existing hierarchy without provider calls. Refuse editing when no configured destination exists.
- [x] Extract reusable application logic for applying parsed category operations to an aggregate. Reuse the existing parent-aware parser without calling the onboarding use case that saves immediately.
- [x] Support adding, renaming, and deactivating categories; adding, renaming, moving, and deactivating children. Require explicit parents for child operations.
- [x] Preserve children when renaming their parent. Show every affected child when deactivating a category. The final confirmation explicitly approves the complete branch change.
- [x] Reject empty names, duplicate active names, invalid parents, move collisions, and confirmation of a hierarchy with no active categories.
- [x] Resolve identity collisions explicitly: known IDs remain authoritative; renames and moves into another active or inactive entry's reserved name are rejected. Adding a previously deactivated name reactivates its original identity; reactivating a category does not silently restore its old children.
- [x] Refactor persistence into transaction-aware infrastructure helpers shared by the existing repository and the settings commit adapter. Keep domain/application code independent of Drizzle.
- [x] At commit, lock conversation and configuration in the existing order, verify revision, flow, expiry, active destination, catalog baseline, and absence of a financial claim. Validate that every existing ID belongs to the owned configuration before writing.
- [x] Commit hierarchy changes and transition to `IDLE` in one transaction. A stale/conflicting commit makes no catalog change and asks the user to reopen settings. A database failure retains the draft for retry.
- [x] Preserve the 30-minute inactivity timeout, cancellation, and expense-in-progress protections. Reopening `configuración` inside a draft presents the draft rather than discarding it.
- [x] Wire the use cases outside the optional Google OAuth bundle because local catalog editing requires no provider request.
- [ ] Add domain tests for hierarchy operations and identity collisions; PostgreSQL tests for stable IDs, rollback, baseline conflicts, and unchanged historical snapshots; worker tests for commit, cancellation, expiry, malformed drafts, and stale replies.
- [x] Update chat settings, hierarchy, and data-model documentation plus the feature index. Record the draft/commit and identity policy in an ADR and update the ADR index.
- [x] Run the relevant tests and `pnpm test`; resolve failures before completing the phase. (The PostgreSQL suites and full local suite passed.)
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Configure payment methods and use them throughout expenses

**Description:** Add menu option `6. Medios de pago` and deliver the complete manual catalog workflow, including visible selection, correction, unknown-value resolution, persistence, and retry compatibility.

**Contracts**

- `PaymentMethodCatalog` exposes add, rename, and deactivate operations with stable IDs.
- `IPaymentMethodCatalogRepository.findBySpreadsheetId(id): Promise<PaymentMethodCatalog | null>` distinguishes unconfigured catalogs from confirmed empty catalogs.
- Extend `SettingsVocabularyFlow` and `SettingsVocabularyCommit` with `kind: 'payment_methods'` and the corresponding draft screen.
- `ResolvePaymentMethod.execute({ catalog, rawValue })` returns a discriminated selection: `legacy`, `none`, `matched`, or `unresolved`.
- `ResolveExpensePaymentMethod.execute({ userId, expected, authorization, action })` accepts `select`, `add`, or `clear` and returns an updated review or a typed stale/invalid outcome.
- Add a canonical `paymentMethodSelection` to review payloads, including source configuration, status, nullable ID, canonical name, and unresolved raw text.
- Extend `UserContext` with configured payment names and catalog capability; extend `CorrectionField` with `medio_pago` and correction suggestions with nullable `medioPago`.
- Extend `ExpenseSummary` with payment label/status and change `actions.confirm` from literal `true` to `boolean`.
- Extend `ExpenseRecord` with nullable `paymentMethodId`; retain `medioPago` as the immutable confirmed text snapshot.

**To-do**

- [x] Add `user_payment_methods` with UUID, configuration FK using explicit `ON DELETE CASCADE`, display name, normalized name, active flag, and creation timestamp. Enforce configuration-scoped normalized-name uniqueness and indexes supporting active lookups.
- [x] Add nullable `payment_methods_confirmed_at` to configurations and nullable `payment_method_id` to expenses, with an indexed FK using `ON DELETE SET NULL`. Generate additive migrations in the repository's configured migration directory; do not backfill historical selections.
- [x] Use trim plus lowercase normalization for catalog identity, retaining display spelling. Do not silently merge accents, aliases, or semantically similar methods.
- [x] Implement manual add/rename/deactivate through the same draft and atomic commit mechanism as Phase 1. Confirming an empty catalog enables configured mode; cancellation leaves legacy mode unchanged.
- [x] Load payment context during interpretation and correction. Update OpenAI, Claude, NVIDIA, Groq, shared prompts/schema mapping, and fallback contracts consistently. Catalog names remain untrusted data.
- [x] Preserve the payment text actually mentioned by the user. Resolve exact normalized catalog matches deterministically; do not guess a specific card from generic “tarjeta” or infer payment from the expense category.
- [x] Normalize missing selection fields in persisted legacy reviews to the existing `extracted.medioPago` with no ID. Preserve legacy retries without new NLP or catalog interpretation.
- [x] Display the payment method or `Sin medio de pago` in ordinary, corrected, zero-amount, and high-amount summaries. Show unresolved names explicitly.
- [x] Keep unresolved payments in `EXPENSE_REVIEW`, hide the save action, and offer explicit commands to select an existing method, add the displayed unknown method, or clear it. A plain confirmation never creates a method.
- [x] Guard resolution commands against stale reviews and failed presentation using the existing authorization model. Successful resolution advances the review revision, clears presentation authority, and requires a newly presented summary before saving.
- [x] Persist explicit catalog additions and the updated review atomically. Explain that adding a method updates the catalog independently of the subsequent expense confirmation.
- [x] Extend natural-language correction with payment changes and explicit clearing. Validate combined corrections before changing state; an unknown payment produces a coherent updated review that remains unsavable until resolved.
- [x] Enforce the unresolved-payment guard in confirmation authorization and defensively before spreadsheet append. Preserve execution-claim, high-amount, zero-amount, and duplicate-confirmation protections.
- [x] Persist the canonical payment name and nullable ID only after a confirmed append. Write the name externally only when `medio_pago` is mapped; never insert or shift columns implicitly.
- [x] Carry selections through clarification, correction state, retry envelopes, queue progression, and undo re-presentation. Retries reuse reviewed values; queued raw messages use the catalog active when interpreted.
- [x] Validate configuration ownership before using payment IDs. Reject a destination mismatch before external effects rather than attaching a method from another configuration.
- [x] Update dependency wiring, worker dispatch, deterministic routing, summary presenters, and correction guidance. Preserve the existing semantic-router authority boundaries.
- [x] Add tests for unconfigured versus empty catalogs, known/unknown/absent methods, explicit add/select/clear, inactive-name collisions, no automatic additions, and atomic mixed corrections.
- [ ] Add PostgreSQL and worker lifecycle tests for cancellation after explicit addition, stale actions, failed append, canonical snapshots, retries without NLP, unmapped columns, historical records, and exact-row undo.
- [x] Document payment methods and update settings, correction, summary, confirmation, data-model, and relevant indexes. Add an ADR for catalog scope, legacy compatibility, and independent explicit additions.
- [x] Run the relevant provider, application, integration, and lifecycle tests and `pnpm test`; resolve failures before completing the phase.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Detect and review payment methods during configuration

**Description:** Integrate payment catalog proposals into initial onboarding and destination changes, while preserving current configurations until final confirmation.

**Contracts**

- `DetectPaymentMethods.execute({ userId, provider, fileId, sheetName, mappings, headerRowIndex }): Promise<PaymentMethodProposal>` returns ordered unique names and whether the payment column is mapped.
- Extend `SettingsDestinationCandidate` with the reviewed payment-method list.
- Extend `SettingsConfigurationActivation.execute` to persist the payment catalog and confirmation marker in its existing atomic activation transaction.
- Add `OnboardingVocabularyCommit.execute({ userId, expected, sourceConfigId, categories, paymentMethods })` to persist reviewed vocabularies, confirmation markers, user activation, and the final conversation transition atomically.
- Extend existing category-review payloads with explicit review stages for categories and payment methods. Keep `ONBOARDING_CATEGORIES` and `SETTINGS_CATEGORIES`; missing stage values mean category review.

**To-do**

- [x] Detect values through the existing spreadsheet port's unique-column reader, starting after the confirmed header row. Trim values, ignore blanks, deduplicate by catalog normalization, and preserve first-seen order.
- [x] Read cell values only. Do not claim that existing dropdown definitions or every provider-side validation rule have been imported.
- [x] If no payment column exists, offer an empty editable proposal with local-only guidance. If a mapped column is empty, offer an empty proposal without inventing defaults.
- [x] Treat provider failures as failures, not empty catalogs. Offer retry or cancellation and preserve the owned draft and current active destination.
- [x] After category review, present payment methods for editing and confirmation. Explain that final confirmation activates the complete reviewed configuration.
- [x] Reuse payment draft operations without writing the live catalog. Detection occurs when creating the proposal or on explicit retry, not on every message.
- [x] For destination changes, detect from the candidate destination and create new catalog IDs under its new configuration. Do not copy the previous catalog automatically.
- [x] Extend destination activation to commit mappings, hierarchy, payment methods, confirmation markers, active-configuration replacement, and conversation exit together.
- [x] Refactor onboarding finalization so activation and completion messaging occur only after both vocabularies commit. Repeated finalization is idempotent and preserves matching identifiers.
- [x] Support in-flight legacy category-review payloads by introducing the payment-review stage before finalization. Previously completed configurations remain in legacy payment mode until explicitly configured.
- [x] For existing users opening an unconfigured payment catalog, offer detection as an explicit action; retain manual setup if the provider is unavailable. For configured catalogs, “detectar” adds proposed missing values to the draft and does not silently remove manual entries.
- [x] Update guarded transitions, expiry handling, cancellation, worker dispatch, dependency wiring, and semantic routing for the added payload stages.
- [x] Add detection tests for header offsets, blank/duplicate values, missing mappings, empty columns, and provider errors. Add integration tests proving complete rollback on activation failure. (The PostgreSQL assertions passed.)
- [ ] Add end-to-end scenarios for new onboarding, legacy in-flight onboarding, changing file/sheet, manual additions, cancelled proposals, repeated confirmation, and unchanged previous expense history.
- [x] Update onboarding, settings, payment-method, conversation-state, and architecture documentation with their corresponding indexes.
- [x] Verify the full migration chain in isolated PostgreSQL, including pre-feature rows. Apply migrations before deploying consumers; preserve compatibility with existing payloads and records. (Verified in an isolated Docker PostgreSQL container; no deployment has occurred.)
- [ ] Run `pnpm test` and the relevant integration/E2E suites. Complete a connected staging walkthrough covering configuration, unknown-method resolution, correction, save, retry, and cancellation.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Validation still needed

- Final local gates: `corepack pnpm run format:check`, `corepack pnpm run lint`, `corepack pnpm run typecheck`, and `git diff --check` passed. The full run with `RUN_POSTGRES_INTEGRATION=true` and `--hookTimeout 120000` passed all 198 files and 2,586 tests, including the nine PostgreSQL suites and the pre-feature-row migration chain. The test suite required permission to bind local ports and access Docker because the sandbox blocks them.
- Complete the connected staging walkthrough after the additive migration is applied. This workspace has no staging credentials or connected provider environment.
- Add the remaining broad worker lifecycle and end-to-end scenarios listed above. Current tests cover empty mapped payment columns, detection failure and retry, manual proposal edits, cancellation before activation, cancellation after explicit catalog addition, mapped and unmapped canonical payment snapshots, and retrying a confirmed payment selection after an append failure.

## Next step

Complete the remaining broad lifecycle and end-to-end scenarios, then apply the additive migration before consumers and perform the connected staging walkthrough.
