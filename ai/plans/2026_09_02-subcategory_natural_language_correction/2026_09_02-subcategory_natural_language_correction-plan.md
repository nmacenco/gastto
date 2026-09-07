# Subcategory Natural-Language Correction

## Goal

Allow users to correct a category and optional linked subcategory atomically in natural language. Reject invalid parent/child combinations without changing the stored review, while normalizing legacy conversational payloads and preserving correction, queue, retry, timeout, and confirmation behavior.

## Context

- [`src/domain/ports/services.ts`](../../../src/domain/ports/services.ts): Provider-neutral correction fields, suggestion values, hierarchy context, and `LLMPort.interpretCorrection()` contract.
- [`src/domain/value-objects/expense-review-payload.ts`](../../../src/domain/value-objects/expense-review-payload.ts): Persisted review payload and the canonical normalization boundary for legacy hierarchy fields.
- [`src/domain/value-objects/expense-correction-state.ts`](../../../src/domain/value-objects/expense-correction-state.ts): Immutable correction-cycle state, JSONB deserialization, and review/extraction validation.
- [`src/domain/value-objects/expense-clarification-state.ts`](../../../src/domain/value-objects/expense-clarification-state.ts): Persisted partial extraction used before review and by queued-expense progression.
- [`src/domain/value-objects/expense-save-retry-payload.ts`](../../../src/domain/value-objects/expense-save-retry-payload.ts): Retry envelope and nested reviewed-expense validation.
- [`src/domain/entities/CategoryVocabulary.ts`](../../../src/domain/entities/CategoryVocabulary.ts): Active parent/child hierarchy and parent-scoped child lookup.
- [`src/application/use-cases/expense/CorrectExpenseUseCase.ts`](../../../src/application/use-cases/expense/CorrectExpenseUseCase.ts): Context construction, correction application, category classification, cycle limits, high-amount checks, and review transition.
- [`src/application/use-cases/expense/ClassifyExpenseCategory.ts`](../../../src/application/use-cases/expense/ClassifyExpenseCategory.ts): Parent-first classifier used to resolve stable category/subcategory selections.
- [`src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase.ts`](../../../src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase.ts): Confirm/cancel precedence, direct review corrections, and new-expense queue admission.
- [`src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts`](../../../src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts): Inline correction entry and persisted correction snapshot creation.
- [`src/application/use-cases/expense/RetryExpenseSaveUseCase.ts`](../../../src/application/use-cases/expense/RetryExpenseSaveUseCase.ts): Retry-payload validation and replay without new NLP.
- [`src/application/copies/expense.copies.ts`](../../../src/application/copies/expense.copies.ts): Correction examples, invalid-child guidance, queue notices, cycle-limit copy, and high-amount copy.
- [`src/infrastructure/adapters/llm/OpenAIAdapter.ts`](../../../src/infrastructure/adapters/llm/OpenAIAdapter.ts): OpenAI correction schema, contextual prompt, untrusted hierarchy serialization, and result mapping.
- [`src/infrastructure/adapters/llm/ClaudeAdapter.ts`](../../../src/infrastructure/adapters/llm/ClaudeAdapter.ts): Claude correction schema, contextual prompt, parsing, and result mapping.
- [`src/infrastructure/adapters/llm/NvidiaAdapter.ts`](../../../src/infrastructure/adapters/llm/NvidiaAdapter.ts): NVIDIA correction schema, contextual prompt, parsing, and result mapping.
- [`src/interfaces/workers/message.worker.ts`](../../../src/interfaces/workers/message.worker.ts): Review/correction payload loading, correction outcome rendering, queue routing, and summary re-presentation.
- [`src/bootstrap/buildDependencies.ts`](../../../src/bootstrap/buildDependencies.ts): Correction use-case hierarchy repository and classifier dependency wiring.
- [`docs/adr/adr.md`](../../../docs/adr/adr.md): ADR-002 provider-neutral structured LLM extraction, ADR-003 persisted FSM, and ADR-005 asynchronous processing constraints.
- [`docs/adr/ADR-022-linked-subcategory-hierarchy.md`](../../../docs/adr/ADR-022-linked-subcategory-hierarchy.md): Active parent hierarchy, stable identifiers, scoped uniqueness, and snapshot/reference strategy.
- [`docs/architecture/module-contracts.md`](../../../docs/architecture/module-contracts.md): Clean Architecture import and dependency-injection boundaries.
- [`docs/architecture/async-pipeline.md`](../../../docs/architecture/async-pipeline.md): Worker-owned NLP, durable state, queue, retry, and presentation responsibilities.
- [`docs/features/expense-correction.md`](../../../docs/features/expense-correction.md): Current correction fields, atomic multi-field behavior, persisted-state rules, and regression coverage.
- [`docs/features/subcategory-hierarchy.md`](../../../docs/features/subcategory-hierarchy.md): Implemented hierarchy activation, parent-first classification, stable review fields, and Phase 5 compatibility boundary.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): Domain, application, provider, worker, FSM, queue, retry, and failure-path testing requirements.
- [`E1-US-18 - Classify and register linked subcategories`](../../../docs/user-stories/02-release-2-producto-complejo/01-epica-1/E1-US-18%20%E2%80%94%20Classify%20and%20register%20linked%20subcategories.md): Canonical correction, rejection, legacy JSONB, queue, and retry acceptance criteria.
- [`Subcategory Classification and Expense Review`](../2026_09_02-subcategory_classification_and_review/2026_09_02-subcategory_classification_and_review-plan.md): Completed prerequisite that creates stable hierarchical review selections and hierarchy-aware summaries.

### Public contracts introduced or extended

- `CorrectionField`: adds `subcategoria` to `monto | moneda | categoria | fecha`; a provider may return category and subcategory together in one ordered `changedFields` collection.
- `ExpenseCorrectionSuggestion`: adds `subcategoriaRaw: string | null`. Non-correction intents keep every value null and an empty field list.
- `CorrectExpenseOutcome`: adds `{ status: 'invalid_subcategory'; parentCategory: string; attemptedSubcategory: string; allowedSubcategories: string[] }`. This branch carries guidance data only and never an updated review payload.
- `normalizeExtractedExpensePayload(value)`: accepts canonical extraction objects and legacy objects missing `subcategoriaRaw` or `confianzaSubcategoria`, returning explicit `null` and `nula` defaults after validating every existing field.
- `normalizeExpenseReviewPayload(value)`: validates the complete review and returns explicit `resolvedSubcategory: null`, `resolvedSubcategoryId: null`, `subcategoryStatus: 'none'`, and `subcategoryEnabled: false` for missing legacy fields; explicit canonical hierarchy fields are preserved and cross-field invariants are enforced.
- `parseExpenseSaveRetryPayload(value)`: validates the retry envelope and returns its nested reviewed expense in canonical normalized form, or a typed invalid result/null according to the current retry boundary.

## Phases

### Phase 1: Extend correction extraction across all providers

#### Description

Teach the provider-neutral correction boundary and every configured LLM adapter to identify an optional subcategory correction using the active hierarchy as untrusted context. This phase changes extraction only and does not apply or persist hierarchy corrections.

#### To-do actions

- [x] Add `subcategoria` to `CorrectionField` and `subcategoriaRaw: string | null` to `ExpenseCorrectionSuggestion`; keep all existing field names, intent values, and non-correction nullability rules unchanged.
- [x] Update the OpenAI, Claude, and NVIDIA correction Zod schemas so `changed_fields` accepts `subcategoria`, `subcategoria_raw` is always present and nullable, and `new_expense`/`unrelated` reject non-null correction values or non-empty changed fields.
- [x] Update each provider correction prompt with category/subcategory distinction, combined parent/child examples, child-only examples, an explicit category-without-child case, and instructions never to invent or re-parent a child.
- [x] Make `CorrectExpenseUseCase.buildUserContext()` load the active `CategoryVocabulary`, expose ordered active parents and children, and preserve the payload capability flag while treating a legacy payload as hierarchy-disabled.
- [x] Serialize `categoryHierarchy` and `subcategoryEnabled` through each adapter's existing `serializeUntrustedData()` boundary; do not interpolate configured names into trusted prompt instructions.
- [x] Map validated `subcategoria_raw` identically in all provider adapters while preserving current malformed JSON, schema error, timeout, and empty-response behavior.
- [x] Extend `OpenAIAdapter.spec.ts`, `ClaudeAdapter.spec.ts`, and `NvidiaAdapter.spec.ts` with category-and-child, child-only, no-child, non-correction rejection, malformed field, active-parent isolation, equal child names under different parents, and prompt-injection cases.
- [x] Extend `CorrectExpenseUseCase.spec.ts` and dependency-wiring tests to verify canonical hierarchy context, legacy-disabled context, stable ordering, and no correction/state mutation during provider interpretation.
- [x] Run the focused correction contract, all three LLM adapter, correction context, and dependency-wiring test suites.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Apply parent-aware corrections atomically

#### Description

Resolve category and subcategory changes as one hierarchy selection. A valid correction produces one updated review; an invalid child returns typed guidance and leaves the persisted review and correction-cycle state untouched.

#### To-do actions

- [ ] Refactor `CorrectExpenseUseCase.applySuggestion()` to collect requested category/subcategory changes before mutating a payload and invoke the hierarchical classifier once with both suggestions when both fields are present.
- [ ] For a child-only correction, classify against the current resolved active category and never search another parent's children; reject the attempt if the current parent is unresolved or stale.
- [ ] For a category-only correction, preserve the existing child only when its stable ID still belongs to the resolved parent; otherwise clear `resolvedSubcategory`, `resolvedSubcategoryId`, `subcategoryStatus`, `extracted.subcategoriaRaw`, and child confidence to canonical no-child values.
- [ ] For a combined category/subcategory correction, apply both selections only when the resolved active child belongs to the newly resolved parent; never expose a partial parent update when the child is invalid.
- [ ] Add the `invalid_subcategory` correction outcome with the attempted child, selected parent name, and that parent's ordered active child names; return it before `ExpenseCorrectionState.next()`, high-amount evaluation, or any FSM transition.
- [ ] Preserve the complete stored review on rejection, including category/subcategory fields, correction-cycle count, review TTL, pending high-amount flag, queue count, and undo metadata.
- [ ] Add an `expenseCopies` guidance message that identifies the selected parent and lists its allowed active children, including an explicit no-configured-children variant, without presenting an updated summary.
- [ ] Extend `renderExpenseReviewReplyOutcome()` for the typed rejection branch and ensure both direct `EXPENSE_REVIEW` correction and inline `EXPENSE_CORRECTING` correction send exactly one guidance message with no state mutation or queue admission.
- [ ] Preserve confirm/cancel precedence, `new_expense` versus `unrelated` routing, the five-cycle limit, review timeout reset after accepted corrections, corrected high-amount checks, and the existing one-summary presentation path.
- [ ] Extend `CorrectExpenseUseCase.spec.ts` for valid combined correction, category-only child preservation/clearing, child-only correction, equal child names under different parents, inactive/stale parents and children, empty allowed-child lists, atomic rejection, one classifier call, cycle counting, timeout, and high-amount behavior.
- [ ] Extend `ResolveExpenseReviewReplyUseCase.spec.ts`, summary-action tests, and `message.worker.spec.ts` for direct and inline accepted/rejected corrections, unchanged payloads, no queue calls on invalid children, confirmation precedence, and exactly one presentation or guidance message.
- [ ] Run the focused correction use-case, review-reply, summary-action, copy, worker, classifier, and dependency-wiring test suites.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Centralize legacy state normalization and close compatibility

#### Description

Normalize hierarchy fields at every persisted conversational boundary so pre-deployment JSONB continues through clarification, review, correction, queue progression, retry, cancellation, and confirmation. Close the phase with documentation and full regression validation without activating Phase 7 persistence behavior.

#### To-do actions

- [ ] Add shared extraction and review normalizers at the domain boundary; validate all existing fields, preserve explicit canonical hierarchy values, and default only missing legacy hierarchy fields to `null`, `nula`, `none`, and `false`.
- [ ] Enforce canonical cross-field invariants available without repository access: a selected child requires a resolved category and non-null child ID/name, disabled hierarchy cannot expose a selected child, and no-child values use null identifiers/names plus `none`/`nula`; keep parent-membership validation in the classifier/use case.
- [ ] Make `ExpenseCorrectionState.create()` and `fromPayload()` consume the shared normalizer and make `toPayload()` emit canonical hierarchy fields, while retaining type markers, correction-cycle validation, and pending high-amount compatibility.
- [ ] Make `ExpenseClarificationState.create()` and `fromPayload()` normalize legacy `partialExtracted` values and serialize canonical child extraction fields without changing supported missing fields or queue-count semantics.
- [ ] Replace permissive retry-envelope checking with `parseExpenseSaveRetryPayload()` so valid legacy nested reviews are normalized before `RetryExpenseSaveUseCase` replays them and invalid/expired payloads retain the current safe `IDLE` recovery behavior.
- [ ] Replace the worker-local review guard/casts with the shared review parser before confirm, cancel, direct correction, timeout, and re-presentation paths; invalid payloads retain structured logging, safe reset, and fallback messaging.
- [ ] Verify queued expenses remain raw-message queue items, still obey FIFO and capacity rules, and produce canonical review/clarification payloads only when dequeued through normal registration; do not add hierarchy data to the queue table or replay NLP during save retry.
- [ ] Preserve spreadsheet/local persistence behavior from Phase 5: correction and normalization must not write a subcategory externally, consume review IDs in `expense_records`, alter undo, or implement any Phase 7 save change.
- [ ] Extend `expense-correction-state.spec.ts`, `expense-clarification-state.spec.ts`, and review/retry payload tests with canonical, legacy-missing, explicit-null, malformed, contradictory, round-trip, and metadata-preservation cases.
- [ ] Extend `RetryExpenseSaveUseCase.spec.ts`, queue use-case/repository tests, `ResolveExpenseReviewReplyUseCase.spec.ts`, summary-action tests, and `message.worker.spec.ts` for legacy confirmation, correction, cancellation, clarification completion, queue progression, retry, timeout, invalid-state recovery, and unchanged category-only presentation.
- [ ] Add regression assertions that accepted corrections transition exactly once, rejected corrections never transition or enqueue, queue overflow never mutates active state, retries never invoke NLP, and confirmation/cancellation precedence remains unchanged.
- [ ] Update `docs/features/expense-correction.md` with `subcategoria`, atomic parent/child application, invalid-child guidance, non-mutation, and legacy normalization behavior.
- [ ] Update `docs/features/subcategory-hierarchy.md` with correction rules, active-parent membership, cleared-child semantics, typed rejection, compatibility defaults, and the unchanged Phase 7 persistence boundary.
- [ ] Synchronize the affected entries in `docs/features/README.md` in the same documentation change.
- [ ] Run the focused correction, provider, payload/state, clarification, retry, queue, summary-action, classifier, and worker test suites.
- [ ] Run `pnpm test` to execute the complete project test suite after the focused tests pass.
- [ ] Run `pnpm run format:check` to verify the TypeScript, tests, plan-driven feature documentation, and feature index follow repository formatting.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Execute Phase 2 to apply parent-aware category/subcategory corrections atomically and reject invalid child selections without mutating review state.
