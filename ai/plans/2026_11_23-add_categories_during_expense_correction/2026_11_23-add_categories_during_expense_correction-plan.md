# Add categories during expense correction

## Goal

Let a user add a missing category or subcategory while correcting an expense, with explicit confirmation and without losing the pending review. Distinguish an unknown name from an uncertain match to an existing entry, and make the settings command discoverable after setup.

## Context

- Follow [repository instructions](../../../AGENTS.md), [plan conventions](../../../docs/plans/plan-conventions.md), [architecture decisions](../../../docs/adr/adr.md), [expense correction](../../../docs/features/expense-correction.md), [subcategory hierarchy](../../../docs/features/subcategory-hierarchy.md), [chat settings](../../../docs/features/chat-spreadsheet-settings.md), [conversation state](../../../docs/architecture/data-model.md), and [testing guidelines](../../../docs/testing/guidelines.md).
- [CorrectExpenseUseCase](../../../src/application/use-cases/expense/CorrectExpenseUseCase.ts) currently returns `not_interpretable` for an unresolved parent and `invalid_subcategory` for an unknown child. [ClassifyExpenseCategory](../../../src/application/use-cases/expense/ClassifyExpenseCategory.ts) can produce a suggested existing category. The new flow must inspect the explicit user target and classification confidence before offering creation.
- [ResolveExpenseReviewReplyUseCase](../../../src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase.ts), [ExpenseCorrectionState](../../../src/domain/value-objects/expense-correction-state.ts), and [message.worker.ts](../../../src/interfaces/workers/message.worker.ts) route review and correction replies. Keep the pending expense, review binding, queue count, financial execution guard, and expiry behavior intact.
- [CategoryVocabulary](../../../src/domain/entities/CategoryVocabulary.ts) enforces parent and child names. [DrizzleSettingsVocabularyCommit](../../../src/infrastructure/db/repositories/DrizzleSettingsVocabularyCommit.ts) and [categoryVocabularyPersistence](../../../src/infrastructure/db/repositories/categoryVocabularyPersistence.ts) demonstrate guarded, transactional catalog changes. Reuse their invariants and persistence helpers where appropriate, without entering the settings menu during an active expense.
- [ConversationState](../../../src/domain/entities/ConversationState.ts) and [conversation schema](../../../src/infrastructure/db/schema/index.ts) define valid states. Model the pending choice as a validated variant of the existing `EXPENSE_CORRECTING` payload if it can preserve all current state invariants; add a dedicated state and schema-first migration only if the variant cannot do so safely. Document any schema change in the data model.
- [Expense copies](../../../src/application/copies/expense.copies.ts) render the current correction guidance. [Onboarding completion copy](../../../src/application/copies/onboarding.copies.ts) omits the `configuración` command, although the [access welcome](../../../src/application/copies/access.copies.ts) already mentions it.

## Phases

### Phase 1: Add a missing category from an active expense review

Description: Deliver a complete category choice and creation flow that the user can exercise while a reviewed expense remains pending.

- [x] Extend `CorrectExpenseOutcome` with a typed unresolved-category result carrying the attempted name, active candidates, and whether the classifier suggested an existing match. Keep unrelated or ambiguous corrections on their existing clarification path; never infer permission to create from an LLM result alone.
- [x] Define and validate a persisted pending-choice payload within the expense correction flow. It must retain the full reviewed expense and correction context, the source configuration ID and catalog revision/baseline, a unique choice identity, and the existing review deadline. Route its replies before ordinary correction interpretation. A stale reply or callback must not confirm an old choice.
- [x] Present explicit choices for an unknown category: choose an existing category, add the named category, or cancel the choice. For a plausible existing match, ask whether the user meant that category before offering creation. Show the exact proposed name in a separate creation-confirmation prompt; only an affirmative reply to that prompt may write the catalog. Define `cancelar` behavior clearly: abandon the pending expense according to the existing cancellation contract, while a separate back/choose action returns to the unmodified review.
- [x] Add an application use case and persistence port for confirming one category addition. Its transaction must lock and verify the owned conversation/review, active spreadsheet configuration, catalog baseline, expiry, and absence of a financial execution claim; apply the aggregate's duplicate, inactive-name, and stable-ID rules; persist the category and transition back to `EXPENSE_REVIEW` atomically. On duplicate or concurrent catalog change, show current choices without a partial write. On retry, avoid duplicate insertion. Never append the expense to the spreadsheet during category creation.
- [x] Rebind the selected category to its persisted ID, clear an incompatible child, advance the review binding, and re-present the full expense summary. Require the usual expense confirmation before saving. Preserve other corrected fields and pending queue metadata.
- [x] Add meaningful unit and database integration tests for unknown versus suggested names, explicit confirmation, choosing an existing category, cancellation/back, duplicate and inactive names, stale/replayed replies, expiry, concurrent catalog edits, transaction rollback, and unchanged spreadsheet/expense records before final confirmation.
- [x] Update `docs/features/expense-correction.md`, `docs/features/subcategory-hierarchy.md` where relevant, and `docs/features/README.md`. Update `docs/architecture/data-model.md` if the persisted contract or schema changes. Run `pnpm test` for the affected and full suites; fix failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Add a missing subcategory and expose settings after setup

Description: Extend the reviewed-expense choice flow to children under a specific parent, then tell users about settings when setup completes.

- [ ] Extend the typed correction result and pending-choice payload with the selected parent ID and attempted child name. Resolve children only within that parent. When the parent is unknown or merely suggested, settle the parent first; do not create a child under an inferred parent.
- [ ] Present the active children under that parent and the choices to select an existing child, add the named child, or cancel. Require a second explicit confirmation naming both child and parent. If no subcategory is currently configured, explain that the child can be stored in Gastto and will be written to the spreadsheet only when a subcategory column is mapped.
- [ ] Extend the guarded catalog-confirmation use case and transaction for one child addition. Enforce parent existence, active status, duplicate/inactive child rules, source configuration and review ownership, baseline freshness, expiry, and idempotent retry. Rebind the saved child ID, advance the review binding, and re-present the pending expense without saving it. Preserve parent/child snapshots and existing spreadsheet-column behavior.
- [ ] Add `configuración` guidance to the onboarding completion message, explaining that option 5 manages categories and subcategories after setup. Keep the current immediate-expense example.
- [ ] Add tests for parent-scoped duplicate names, same child name under different parents, missing or changed parent, mapped and unmapped child columns, stale/replayed confirmation, cancel/back, full review restoration, final expense confirmation, and the setup-completion copy.
- [ ] Update `docs/features/expense-correction.md`, `docs/features/subcategory-hierarchy.md`, `docs/features/chat-spreadsheet-settings.md`, and `docs/features/README.md`. Update `docs/architecture/data-model.md` if the persisted contract or schema changes. Run `pnpm test` for the affected and full suites; fix failures.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Implement Phase 2: add the parent-scoped subcategory flow and expose settings after setup.
