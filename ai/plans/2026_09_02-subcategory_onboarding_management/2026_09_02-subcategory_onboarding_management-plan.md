# Subcategory Onboarding Management and Confirmation

## Goal

Enable users to detect, review, modify, and confirm a linked category/subcategory hierarchy during the existing `ONBOARDING_CATEGORIES` flow. Preserve category-only spreadsheets, legacy conversation payloads, reconnection behavior, and idempotent re-confirmation without adding an HTTP route or FSM state.

## Context

- [`src/application/use-cases/spreadsheet/DetectCategories.ts`](../../../src/application/use-cases/spreadsheet/DetectCategories.ts): Current category-only detection, default fallback, eager vocabulary persistence, prompt, and state transition.
- [`src/application/use-cases/spreadsheet/ModifyCategoryVocabulary.ts`](../../../src/application/use-cases/spreadsheet/ModifyCategoryVocabulary.ts): Current flat add, remove, and rename orchestration and payload reconstruction.
- [`src/application/use-cases/spreadsheet/ConfirmCategories.ts`](../../../src/application/use-cases/spreadsheet/ConfirmCategories.ts): Current confirmation timestamp, user activation, cleared `IDLE` transition, reconnect path, and idempotent re-confirmation behavior.
- [`src/domain/entities/CategoryVocabulary.ts`](../../../src/domain/entities/CategoryVocabulary.ts): Implemented parent-scoped add, rename, move, remove, duplicate, and branch-removal invariants.
- [`src/domain/ports/categoryHierarchyReader.ts`](../../../src/domain/ports/categoryHierarchyReader.ts): Implemented row-preserving hierarchy result and provider-neutral reader/factory contracts.
- [`src/domain/ports/categoryModificationParser.ts`](../../../src/domain/ports/categoryModificationParser.ts): Current flat category modification intent union and parser port.
- [`src/infrastructure/adapters/RegexCategoryModificationParser.ts`](../../../src/infrastructure/adapters/RegexCategoryModificationParser.ts): Shared Spanish/English deterministic parser that must recognize parent-aware operations.
- [`src/infrastructure/db/repositories/DrizzleCategoryVocabularyRepository.ts`](../../../src/infrastructure/db/repositories/DrizzleCategoryVocabularyRepository.ts): Transactional complete-hierarchy save, stable-ID reconciliation, reactivation, and soft-disable boundary.
- [`src/application/copies/onboarding.copies.ts`](../../../src/application/copies/onboarding.copies.ts): Shared Telegram and WhatsApp onboarding prompts, errors, and completion copy.
- [`src/interfaces/workers/message.worker.ts`](../../../src/interfaces/workers/message.worker.ts): `ONBOARDING_CATEGORIES` routing, interrupted-detection recovery, confirmation detection, and use-case delegation.
- [`src/bootstrap/buildDependencies.ts`](../../../src/bootstrap/buildDependencies.ts): Google and Microsoft spreadsheet adapter factories and onboarding use-case dependency wiring.
- [`docs/adr/adr.md`](../../../docs/adr/adr.md): ADR-003 persisted FSM, ADR-004 spreadsheet adapter boundary, and ADR-005 asynchronous worker constraints.
- [`docs/adr/ADR-022-linked-subcategory-hierarchy.md`](../../../docs/adr/ADR-022-linked-subcategory-hierarchy.md): Parent-scoped hierarchy, soft-disable, stable identifier, and transactional aggregate persistence decision.
- [`docs/architecture/data-model.md`](../../../docs/architecture/data-model.md): Canonical `user_categories`, `user_subcategories`, spreadsheet configuration, and conversation payload persistence model.
- [`docs/features/category-confirmation.md`](../../../docs/features/category-confirmation.md): Implemented flat onboarding, modification, reconnection, and confirmation behavior to preserve.
- [`docs/features/README.md`](../../../docs/features/README.md): Feature documentation index that must include the new hierarchy document.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): Unit, integration, FSM, failure-path, provider-boundary, and full-suite testing rules.
- [`HU-4.08 - Configure linked categories and subcategories`](../../../docs/user-stories/02-release-2-producto-complejo/02-epica-4/HU-4.08%20%E2%80%94%20Configure%20linked%20categories%20and%20subcategories.md): Canonical detection, orphan, mutation, confirmation, compatibility, and channel-consistency acceptance criteria.
- [`Subcategory Spreadsheet Mapping and Pair Detection`](../2026_09_02-subcategory_spreadsheet_mapping_detection/2026_09_02-subcategory_spreadsheet_mapping_detection-plan.md): Completed prerequisite that added optional mapping and provider-independent pair detection.

### Public contracts introduced or extended

- `CategoryOnboardingCategory`: `{ name: string; subcategories: string[] }`, ordered for deterministic user presentation.
- `CategoryOnboardingState`: `{ categories: CategoryOnboardingCategory[]; orphanSubcategories: string[]; subcategoryColumnMapped: boolean }` as the canonical `ONBOARDING_CATEGORIES` payload fragment.
- `parseCategoryOnboardingState(payload)`: validates the canonical hierarchy shape and upgrades a legacy `{ categories: string[] }` payload to category nodes with empty child lists, no orphans, and `subcategoryColumnMapped: false`; malformed entries never become vocabulary rows.
- `serializeCategoryOnboardingState(state, previousPayload)`: writes the canonical shape while retaining unrelated onboarding metadata such as the detected header row.
- `DetectCategoriesOutput` and `ModifyCategoryVocabularyOutput`: expose the canonical onboarding state and message while retaining a flat `categories: string[]` projection for current callers during the compatibility rollout.
- `CategoryModificationIntent`: retains the current category `add`, `remove`, and `rename` variants and adds `add-subcategory`, `rename-subcategory`, `move-subcategory`, and `remove-subcategory` variants with explicit source and target parent names where required.
- `ConfirmCategories.execute`: retains its input/output signature, but validates and transactionally saves the complete canonical or legacy hierarchy before marking categories confirmed, activating or reactivating the user, clearing the FSM payload, and sending completion.

## Phases

### Phase 1: Detect and present the linked hierarchy

#### Description

Wire the implemented row-preserving reader into onboarding and introduce one typed state representation. Users with an optional subcategory mapping see their hierarchy and orphan warnings, while users without that mapping continue through the existing flat reader and copy path.

#### To-do actions

- [x] Add `src/application/dtos/CategoryOnboardingState.ts` with the public DTOs and parser/serializer contracts above; normalize the legacy shape without requiring a database migration or changing the generic conversation repository payload type.
- [x] Make canonical parsing reject malformed category nodes, non-string names, non-array child collections, and non-string orphan entries instead of coercing them into vocabulary values; deduplicate category names and children through `CategoryVocabulary` invariants rather than duplicating persistence rules in the DTO.
- [x] Extend `DetectCategoriesDeps` with `ICategoryHierarchyReaderPortFactory` and wire both the existing flat reader and the hierarchy reader from the active provider's `SpreadsheetPortFactory` in `buildDependencies.ts`.
- [x] Keep the current flat path unchanged when no confirmed `subcategoria` mapping exists: read unique categories, use the current defaults when empty, persist no subcategories, set `subcategoryColumnMapped` to `false`, and preserve the current user-facing prompt semantics.
- [x] When both hierarchy mappings exist, call `readHierarchy()` once with the category and subcategory indexes, sheet name, and resolved data-start row; never combine independent unique-value lists or issue a second provider read.
- [x] Build every parent before adding its detected children, retain first-seen category/pair order, permit an equal child name under different parents, exclude every orphan from the aggregate, and keep the reader's deduplicated orphan values only for warning and audit presentation.
- [x] If the mapped hierarchy contains no valid category, offer the current default categories with empty subcategory lists; never attach orphan values or invent default subcategories.
- [x] Merge an already active persisted vocabulary with newly detected rows during interrupted or repeated onboarding so manually added active entries and stable IDs survive reconnection; persist the resulting complete aggregate through the existing transactional repository and keep repeated detection idempotent.
- [x] Extend `onboarding.copies.ts` with deterministic nested hierarchy formatting and a separate orphan warning that names every excluded value and states that no parent was assigned; reuse the shared copy for Telegram and WhatsApp.
- [x] Update the `ONBOARDING_CATEGORIES` worker branch to parse either payload shape when deciding whether detection is complete and when re-sending a prompt; a missing or invalid canonical state delegates back to `DetectCategories` without introducing another FSM state.
- [x] Extend `DetectCategories.spec.ts` for mapped hierarchy detection, one row read, category-only compatibility, empty hierarchy defaults, category-only rows, same child under different parents, orphan exclusion/warning, persisted-vocabulary merge, AUTH reconnect, persistence failure, and repeated detection.
- [x] Add focused DTO tests for canonical round-trips, unrelated payload metadata, legacy `categories: string[]`, empty legacy lists, malformed nodes, duplicate values, and exact optional-property handling.
- [x] Extend `message.worker.spec.ts` and bootstrap dependency tests for hierarchical, legacy, missing, and malformed category payloads plus provider-specific hierarchy-reader wiring.
- [x] Run the focused DTO, `DetectCategories`, worker, copy, and dependency-wiring tests.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Add parent-aware hierarchy management

#### Description

Extend natural-language modification from a flat list to the complete hierarchy. Each accepted operation resolves explicit active parents, delegates invariants to `CategoryVocabulary`, saves the whole aggregate transactionally, and returns the updated nested proposal for another confirmation.

#### To-do actions

- [x] Add typed intent variants for `add-subcategory { name, parent }`, `rename-subcategory { from, to, parent }`, `move-subcategory { name, fromParent, toParent }`, and `remove-subcategory { name, parent }` without weakening the existing flat category intents or `unknown` fallback.
- [x] Extend `RegexCategoryModificationParser` with ordered Spanish and English patterns for commands such as "add Tolls to Transportation", "under Food, rename Delivery to Takeout", "move Streaming from Utilities to Leisure", and "remove Cinema from Leisure"; parse the most specific child/move forms before the flat add, rename, and remove forms.
- [x] Keep parsing deterministic and side-effect free: normalize surrounding command syntax, preserve user-provided names for display, reject missing source/target parents as `unknown`, and do not infer a parent from order, a previous command, or spreadsheet proximity.
- [x] Extend `ModifyCategoryVocabulary` to parse the canonical or legacy state, load the active aggregate, and rebuild from a valid payload only when no aggregate exists; never create a subcategory until its parent resolves to exactly one active category.
- [x] Add a shared exact normalized parent resolver that returns found, not-found, or ambiguous outcomes defensively; reject missing or ambiguous source and target parents and list the active category names the user can choose.
- [x] Apply child add, rename, move, and remove through the existing aggregate methods so parent-scoped duplicates, target collisions, stable child IDs, and source isolation remain domain-owned; keep category removal responsible for deactivating its complete child branch.
- [x] For an accepted mutation, save the complete aggregate in one repository transaction, serialize the updated nested state while preserving orphan warnings and mapping capability, transition back to `ONBOARDING_CATEGORIES`, and send one updated confirmation prompt.
- [x] For unknown, missing-parent, ambiguous-parent, missing-child, duplicate, or move-collision outcomes, do not persist a partial mutation; retain the prior canonical payload, send targeted guidance, and remain in `ONBOARDING_CATEGORIES`.
- [x] Extend onboarding copies with parent-not-found, parent-ambiguous, child-not-found, duplicate/collision, and generic hierarchy-update messages; every response must show enough of the current hierarchy or valid parent candidates for the user to retry.
- [x] Extend `RegexCategoryModificationParser.spec.ts` with Spanish and English category and child commands, precedence collisions, incomplete parent clauses, whitespace/case normalization, and unknown inputs.
- [x] Extend `ModifyCategoryVocabulary.spec.ts` with every successful child operation, same child under two parents, category branch removal, missing and ambiguous parents, missing child, duplicates, move collisions, legacy payload rebuild, repository rollback propagation, rejected-operation non-persistence, and idempotent repeated commands.
- [x] Extend worker tests to prove non-confirming hierarchical messages delegate once to modification and that Telegram and WhatsApp use the same canonical state and shared copy contracts.
- [x] Run the focused parser, aggregate regression, modification, copy, and worker tests.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Confirm atomically and close compatibility documentation

#### Description

Finalize the reviewed hierarchy before onboarding completion. The complete aggregate must save successfully as one transaction before any confirmation timestamp, user activation, cleared `IDLE` state, or completion message occurs.

#### To-do actions

- [x] Extend `ConfirmCategoriesDeps` with `ICategoryVocabularyRepository` and make confirmation parse the canonical or legacy payload, load the current aggregate to preserve persisted identifiers, and reconcile the payload into one complete `CategoryVocabulary` before finalization.
- [x] Save the complete category/subcategory aggregate through `ICategoryVocabularyRepository.save()` before updating `categoriesConfirmedAt` or user status; rely on its database transaction so a parent/child failure rolls back the whole proposed hierarchy.
- [x] If the payload is absent, malformed, or contains no valid category, do not activate the user or send completion; remain in `ONBOARDING_CATEGORIES` and delegate or guide the user through fresh detection using the existing recovery path.
- [x] Preserve finalization ordering after the aggregate save: update the confirmation timestamp only when absent, set the user to `active`, transition to `IDLE` with both payload and expiry cleared, and send completion only after every persisted invariant succeeds.
- [x] Preserve re-confirmation idempotency by re-saving the same hierarchy without duplicate rows, skipping only the redundant timestamp update, and still restoring user activation and the cleared `IDLE` state after interrupted onboarding or reconnection.
- [x] Verify that a hierarchy save failure leaves the user unconfirmed/inactive and in `ONBOARDING_CATEGORIES`, and sends no completion message; verify later activation or transition failures also send no false success message.
- [x] Keep the worker's confirmation-intent precedence and `ONBOARDING_CATEGORIES` state unchanged, and ensure canonical plus legacy payloads follow the same confirmation use case on both messaging channels.
- [x] Extend `ConfirmCategories.spec.ts` with hierarchical and legacy confirmation, stable-ID reconciliation, aggregate-save ordering, aggregate rollback, invalid-payload recovery, first confirmation, re-confirmation, activation failure, transition failure, and reconnect behavior.
- [x] Add `src/__tests__/integration/subcategory-onboarding-persistence.integration.spec.ts` with the real repository and migration chain to prove atomic parent/child persistence, orphan exclusion, legacy flat confirmation, same-name children under different parents, idempotent re-confirmation, reactivation after interruption, soft-disable of removed branches, and no partial hierarchy on induced persistence failure.
- [x] Extend `message.worker.spec.ts` with end-to-end routing assertions for interrupted detection, canonical confirmation, legacy confirmation, modification followed by confirmation, invalid payload recovery, and the absence of any new FSM state.
- [x] Create `docs/features/subcategory-hierarchy.md` documenting detection, capability activation, canonical and legacy payloads, nested presentation, orphan handling, all parent-aware commands, transactional persistence, confirmation ordering, reconnection, idempotency, both channels, failure behavior, and QA cases.
- [x] Update `docs/features/category-confirmation.md` to distinguish the retained flat path from hierarchy-enabled behavior and replace stale notes that say the hierarchy reader is not consumed.
- [x] Add or update the `subcategory-hierarchy.md` and category-confirmation entries in `docs/features/README.md` in the same documentation change.
- [x] Run the focused confirmation, worker, parser, DTO, repository, and PostgreSQL onboarding integration tests.
- [x] Run `pnpm test` to execute the complete project test suite after the focused tests pass.
- [x] Run `pnpm run format:check` to verify the new feature document, TypeScript contracts, and tests follow repository formatting.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete; review and commit the Phase 3 implementation and documentation.
