# Plan: Semantic Router Option Selection

## Goal

Enable natural references to displayed spreadsheet files and sheets while resolving every proposal deterministically against the exact persisted option snapshot. Preserve current onboarding, access checks, eager advance, and off/shadow behavior, with no provider identifier accepted from the model and no database migration.

## Context

- [Master constrained semantic router plan](../2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md): Phase 5 scope, prerequisites, approved contracts, and closure evidence.
- [Phase 1 evaluation plan](../2026_09_11-semantic_router_evaluation/2026_09_11-semantic_router_evaluation-plan.md), [Phase 2 confirmation-safety plan](../2026_09_12-semantic_router_confirmation_safety/2026_09_12-semantic_router_confirmation_safety-plan.md), [Phase 3 shadow-pipeline plan](../2026_09_14-semantic_router_shadow_pipeline/2026_09_14-semantic_router_shadow_pipeline-plan.md), and [Phase 4 expense-flow plan](../2026_09_15-semantic_router_expense_flows/2026_09_15-semantic_router_expense_flows-plan.md): Implemented predecessor contracts and verification evidence to retain.
- [ADR-023](../../../docs/adr/ADR-023-constrained-llm-semantic-router.md): The model proposes from a closed vocabulary; application code validates authorization and owns every effect.
- [ADR-014](../../../docs/adr/ADR-014-fsm-eager-advance.md): File selection triggers sheet discovery and sheet selection triggers access validation only after the authoritative transition.
- [Plan conventions](../../../docs/plans/plan-conventions.md), [architecture decisions](../../../docs/adr/adr.md), and [testing guidelines](../../../docs/testing/guidelines.md): Required plan shape, architectural boundaries, test placement, boundary mocks, and negative assertions.
- [Semantic contracts](../../../src/application/services/semantic-router/contracts.ts), [state policy](../../../src/application/services/semantic-router/policy.ts), and [input projection](../../../src/application/services/semantic-router/ProjectSemanticRouterInput.ts): Existing `select_option` decision, bounded option labels and positions, and state/substep allowlist.
- [Semantic turn orchestration](../../../src/application/services/semantic-router/ObserveSemanticRouting.ts), [snapshot validation](../../../src/application/services/semantic-router/ValidateConversationSnapshot.ts), and [worker routing](../../../src/interfaces/workers/message.worker.ts): Existing off/shadow/enabled policy, revision checks, expense-only enabled dispatch, and deterministic onboarding handlers.
- [File selection use case](../../../src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts) and [sheet selection use case](../../../src/application/use-cases/spreadsheet/HandleSheetSelection.ts): Current numbered file selection, direct URL/search branches, normalized sheet-name selection, header-description substep, persistence, and eager advance.
- [File-selection feature](../../../docs/features/select-spreadsheet-file.md), [sheet-selection feature](../../../docs/features/select-sheet.md), [conversation-state management](../../../docs/features/conversation-state-management.md), and [FSM states](../../../docs/architecture/fsm-states.md): Canonical behavior, monotonic revision contract, payloads, and transitions.
- [Semantic evaluation feature](../../../docs/features/semantic-router-evaluation.md) and [incoming-message routing](../../../docs/features/incoming-message-routing.md): Dataset/report rules, pending option-selection scope, deterministic bypasses, and queue behavior.
- [Dependency composition](../../../src/bootstrap/buildDependencies.ts): Runtime construction point for the resolver and option dispatcher.

### Revalidation of Phases 1 through 4

- Phase 1 is present: `semantic-contract-v1` includes `select_option` with a bounded `userReference`; the runtime projection exposes at most 20 ordered `{ position, label }` entries and never exposes provider identifiers to the model.
- Phase 2 is present: conversation state has a monotonic decimal-string `revision`, compare-and-swap preconditions, expiry checks, and reusable snapshot validation. The displayed list can therefore be bound to the persisted revision without a new table or column.
- Phase 3 is present: off and shadow preserve deterministic routing, enabled mode rejects unavailable capabilities, and a post-model snapshot check rejects a changed revision. Option proposals are currently observed but intentionally fail closed in enabled mode.
- Phase 4 is present: enabled expense actions use a typed dispatcher, revalidate the captured precondition immediately before handoff, and record dispatch outcomes without granting the model direct access to effectful ports. Phase 5 will reuse this pattern without changing expense behavior.
- Remaining Phase 5 gap: there is no deterministic unique-reference resolver, enabled option capability, typed file/sheet handoff, selection-specific clarification copy, or option-selection integration evidence.
- Current option sources are ordered `fileList` and `sheetList` payloads. A successful list refresh is a self-transition that increments `ConversationState.revision`; `step: 'searching'` and `step: 'empty-sheet-confirm'` remain outside semantic selection, while the default and `idk` option snapshots are eligible.
- No migration is planned. If implementation discovers that the persisted revision cannot identify the exact presented list, stop and revise this plan before adding persistence.

### Approved delivery boundaries

- Interpret the model's `userReference` only as an untrusted reference to an application-owned snapshot. The model cannot return a file ID, sheet index, provider key, URL-derived ID, or any other effect-bearing identifier.
- Use the existing conversation revision as the option-snapshot revision. Revalidate revision, state, substep, expiry, execution ownership, and payload shape after the model call and immediately before selection effects.
- Resolve strict numeric positions, documented Spanish ordinal/cardinal references, and exact normalized full labels. Normalization is lowercase, Unicode NFD accent removal, trimmed/collapsed whitespace, and no substring, prefix, edit-distance, or first-match fallback.
- Return `ambiguous` for duplicate normalized labels or references that identify multiple positions, `not_found` for zero/out-of-range/unavailable references, and `stale` for a changed snapshot. All three produce application-owned guidance and no selection effect.
- Keep direct file URLs, the file-search branch, sheet header-description requests, single-sheet auto-selection, and empty-sheet confirmation on their current deterministic paths. Semantic option selection must not consume or reinterpret them.
- Keep file access validation, spreadsheet-config persistence, sheet access validation, empty-sheet handling, and eager advance authoritative in the existing use cases. Selection authorization and automatic validation probes are distinct telemetry outcomes.
- Preserve off/shadow equivalence and deterministic fallback. Do not activate a production cohort, run a live provider evaluation, answer product questions, or add semantic cancellation/confirmation/retry behavior in this plan.
- Keep the process-message job contract, webhook contract, database schema, and provider ports unchanged.

### Proposed file ownership

- `src/application/services/semantic-router/ResolveOptionReference.ts`: Pure snapshot/reference resolution and normalization policy.
- `src/application/services/semantic-router/option-capabilities.ts`: Eligible states/substeps and typed semantic option decisions.
- `src/application/services/semantic-router/ObserveSemanticRouting.ts`: Enabled option outcome, selection-specific clarification, and dispatch telemetry lifecycle.
- `src/application/use-cases/spreadsheet/DispatchOptionSelection.ts`: Snapshot revalidation, trusted position mapping, and one typed file/sheet handoff.
- `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts`: Typed displayed-file entry point reusing existing access validation and eager sheet discovery.
- `src/application/use-cases/spreadsheet/HandleSheetSelection.ts`: Typed displayed-sheet entry point reusing existing persistence and eager access validation.
- `src/interfaces/workers/message.worker.ts` and `src/bootstrap/buildDependencies.ts`: Worker dispatch and dependency composition.
- Existing colocated specifications plus `tests/integration/semantic-router-option-selection.integration.spec.ts`: Unit, worker, PostgreSQL/Redis, rollback, and no-effect evidence.
- Canonical selection, routing, evaluation, conversation-state, FSM, and feature-index documentation listed in Context.

### Public contracts

#### Ordered option snapshot and resolver

```ts
type OptionSelectionState = 'ONBOARDING_FILE' | 'ONBOARDING_SHEET';
type OptionSelectionSubstep = null | 'idk';

interface DisplayedOptionReference {
  readonly position: number;
  readonly label: string;
}

interface OptionSelectionSnapshot {
  readonly revision: string;
  readonly state: OptionSelectionState;
  readonly substep: OptionSelectionSubstep;
  readonly options: readonly DisplayedOptionReference[];
}

interface ResolveOptionReferenceInput {
  readonly userReference: string;
  readonly expected: OptionSelectionSnapshot;
  readonly current: OptionSelectionSnapshot;
}

type ResolveOptionReferenceResult =
  | { readonly status: 'resolved'; readonly position: number }
  | { readonly status: 'ambiguous'; readonly candidatePositions: readonly number[] }
  | { readonly status: 'not_found' }
  | { readonly status: 'stale' };

interface ResolveOptionReference {
  execute(input: ResolveOptionReferenceInput): ResolveOptionReferenceResult;
}
```

- `resolved` returns only the unique displayed position. It never returns or accepts a provider identifier.
- `stale` applies when revision, state, substep, ordered positions, or labels differ. Snapshot equality uses the validated bounded projection, not raw JSON serialization of the full payload.
- Numeric parsing is strict for the whole reference. Supported word references and normalization rules are versioned and shared by runtime tests and evaluation fixtures.

#### Semantic orchestration and typed dispatch

```ts
type OptionSelectionSemanticDecision = Extract<
  ConversationDecision,
  { readonly action: 'select_option' }
>;

type SemanticRoutingTurnOutcome =
  | { readonly status: 'deterministic'; readonly reason: SemanticFallbackReason }
  | {
      readonly status: 'expense_action';
      readonly decision: ExpenseSemanticDecision;
      readonly expected: ConversationStatePrecondition;
    }
  | {
      readonly status: 'option_selection';
      readonly decision: OptionSelectionSemanticDecision;
      readonly expected: ConversationStatePrecondition;
      readonly snapshot: OptionSelectionSnapshot;
    }
  | {
      readonly status: 'clarification';
      readonly reason:
        | 'ambiguous_intent'
        | 'mixed_intents'
        | 'ambiguous_reference'
        | 'not_found'
        | 'stale_context'
        | 'unsupported_action';
    };

interface DispatchOptionSelectionInput {
  readonly userId: string;
  readonly externalId: string;
  readonly channel: 'telegram' | 'whatsapp';
  readonly conversationState: ConversationState;
  readonly expected: ConversationStatePrecondition;
  readonly snapshot: OptionSelectionSnapshot;
  readonly decision: OptionSelectionSemanticDecision;
}

type DispatchOptionSelectionOutcome =
  | { readonly status: 'selected'; readonly target: 'file' | 'sheet' }
  | {
      readonly status: 'clarification_required';
      readonly reason: 'ambiguous_reference' | 'not_found' | 'stale_context';
    }
  | { readonly status: 'selection_rejected'; readonly target: 'file' | 'sheet' };

interface DispatchOptionSelection {
  execute(input: DispatchOptionSelectionInput): Promise<DispatchOptionSelectionOutcome>;
}
```

- `ObserveSemanticRouting` may return `option_selection` only for `ONBOARDING_FILE/default` and `ONBOARDING_SHEET/default|idk`, after schema, allowlist, capability, and post-model snapshot validation.
- `DispatchOptionSelection` validates the current snapshot again, calls `ResolveOptionReference`, maps a resolved position to the current application-owned `CloudFile` or `SheetInfo`, and invokes exactly one typed selection entry point.
- Telemetry records proposal, resolution, selection handoff, rejection, and automatic validation-probe outcomes without raw messages, labels, provider IDs, user identifiers, payloads, credentials, or model reasoning.

#### Typed selection handoff

```ts
interface SelectDisplayedFileInput extends Omit<HandleSpreadsheetFileSelectionInput, 'rawMessage'> {
  readonly position: number;
  readonly expected: ConversationStatePrecondition;
}

interface SelectDisplayedSheetInput extends Omit<HandleSheetSelectionInput, 'rawMessage'> {
  readonly position: number;
  readonly expected: ConversationStatePrecondition;
}

interface HandleSpreadsheetFileSelection {
  selectDisplayedFile(
    input: SelectDisplayedFileInput,
  ): Promise<HandleSpreadsheetFileSelectionOutput>;
}

interface HandleSheetSelection {
  selectDisplayedSheet(input: SelectDisplayedSheetInput): Promise<HandleSheetSelectionOutput>;
}
```

- These methods index the validated current payload and reuse existing private selection behavior. They do not stringify the position and call the lexical `execute` path.
- The captured precondition is carried into the authoritative transition or repository mutation boundary so a refreshed list or selected-file change cannot authorize an old reference.
- Existing `execute` signatures and deterministic inputs remain compatible for off/shadow mode, direct URLs, search, numeric replies, exact sheet-name replies, IDK, and single-sheet behavior.

#### User-facing copies and versioning

- Add bounded Spanish copies for ambiguous reference, unavailable/not-found option, and stale/refreshed list guidance. Copies may repeat the current numbered options but never expose IDs or model output.
- Bump the semantic contract, policy, prompt, and dataset versions whenever their serialized shapes or resolution behavior changes. Report option resolution separately from downstream access/persistence/probe success.

## Phases

### Phase 1: Deliver the deterministic resolver and executable evaluation slice

#### Description

Create the pure option-snapshot and unique-reference contracts, then expose their behavior through unit tests and the offline evaluator before enabling any conversational selection effect.

#### To-do actions

- [x] Add `OptionSelectionSnapshot`, `ResolveOptionReferenceInput`, `ResolveOptionReferenceResult`, and a pure `ResolveOptionReference` implementation with strict ordinal/number parsing and versioned full-label normalization.
- [x] Derive snapshots only from validated `ONBOARDING_FILE/default`, `ONBOARDING_SHEET/default`, and `ONBOARDING_SHEET/idk` payloads plus the current conversation revision. Keep `searching`, `empty-sheet-confirm`, malformed payloads, expired state, and unresolved execution claims unsupported.
- [x] Detect revision/state/substep/order/label changes as `stale`; reject zero, negative, partial numeric, out-of-range, empty, unknown, and unavailable references as `not_found`; return every matching position for ambiguous duplicate labels without choosing the first.
- [x] Test numeric positions, Spanish cardinal and ordinal phrases, accent/case/whitespace normalization, duplicate normalized names, identical labels at different positions, punctuation, prompt injection in labels and references, overlong input, reordered/refreshed lists, and selected-file changes.
- [x] Extend the offline evaluation corpus and reports for file/default, sheet/default, and sheet/idk references. Separate proposed-action agreement, unique-resolution accuracy, ambiguity handling, stale rejection, and downstream task completion; keep the last metric unmeasured in this phase.
- [x] Update contract/policy/prompt/dataset versions and their schema/report tests. Preserve the model-facing `{ position, label }` projection and prove that no ID, provider token, payload, revision, or expected label reaches the provider.
- [x] Run focused unit/evaluator tests and the offline evaluation command; do not run a live provider evaluation or claim model quality from protocol fixtures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Enable typed semantic file selection

#### Description

Resolve enabled file references against the current displayed file snapshot and hand the trusted position to the existing access-validation and eager sheet-discovery flow without changing search or direct-URL behavior.

#### To-do actions

- [x] Add the option capability branch to semantic turn orchestration and return `option_selection` only for an allowed, current `ONBOARDING_FILE/default` proposal. Keep off/shadow execution byte-for-byte behaviorally equivalent and keep unavailable option capability fail-closed.
- [x] Implement `DispatchOptionSelection` for file snapshots with immediate precondition and snapshot revalidation, deterministic reference resolution, application-owned `fileList[position - 1]` mapping, and exactly one `selectDisplayedFile` call.
- [x] Extract `selectDisplayedFile` from the current numbered selection path so semantic and deterministic entry points share access validation, confirmation, CAS transition to `ONBOARDING_SHEET`, and isolated eager sheet discovery without a second lexical interpretation.
- [x] Preserve direct URL selection, the "none of these" search transition, free-text search queries, Microsoft unavailable behavior, token reconnect, initial listing, and invalid deterministic selection. Classify those legacy paths before semantic selection where necessary so enabled mode cannot consume them.
- [x] Add application-owned ambiguous/not-found/stale copies that retain `ONBOARDING_FILE` and the current snapshot. Assert zero access validation, state transition, sheet discovery, config write, spreadsheet probe, and success copy for every unresolved or stale reference.
- [x] Test natural labels and ordinals, duplicate file names, stale replies after a refreshed search result, reordered lists, direct URLs, search entry and result replacement, inaccessible files, auth/network failures, provider failure, malformed proposals, lease loss, and revision changes while the model or access validation is pending.
- [x] Extend worker and composition tests for one router call, one resolver call, and at most one typed file handoff. Record selection authorization separately from file-access validation and eager sheet discovery.
- [x] Update file selection, incoming routing, semantic evaluation, conversation-state, FSM, observability, and feature-index documentation for delivered file behavior only.
- [x] Run focused tests and `pnpm test`; keep production activation and live-provider evidence pending.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Enable sheet selection and prove end-to-end option safety

#### Description

Complete semantic option selection for ordinary and header-description sheet snapshots, then verify persistence, access-validation, stale-state, rollback, and evaluation behavior across the full file-to-sheet onboarding slice.

#### To-do actions

- [x] Extend `DispatchOptionSelection` to `ONBOARDING_SHEET/default|idk` and add `selectDisplayedSheet`, sharing the existing config upsert, guarded transition, confirmation copy, and eager `ValidateSpreadsheetAccess` path without re-running name matching.
- [x] Preserve single-sheet auto-confirmation, IDK header descriptions, empty-sheet confirmation, unknown-selection re-prompts, selected-file identity, reconnect behavior, and access-error recovery. Keep `empty-sheet-confirm` deterministic and do not treat it as an option snapshot.
- [x] Reject duplicate normalized sheet names as ambiguous even when the current lexical `.find` path would choose the first. Reject stale replies after file changes, sheet-list refreshes, IDK self-transitions, validation fallback, or any competing revision.
- [x] Add PostgreSQL/Redis integration conversations for natural file then sheet selection, IDK then selection, duplicate names, stale file and sheet replies, concurrent refresh, lock/lease loss, config upsert failure, access-validation failure, empty-sheet fallback, and duplicate message delivery.
- [x] Assert unresolved/stale selection produces no config mutation, file/sheet transition, external selection effect, access probe, success copy, or eager advance. Assert a resolved sheet persists the application-owned name once and only then starts the existing validation probe.
- [x] Exercise `enabled` to `shadow` and `off` rollback with active file and sheet snapshots and already queued messages. Existing payloads and deterministic selection must continue without migration, dead letter, duplicate selection, or lost search/IDK context.
- [x] Extend held-out option-selection families for ordinals, normalized labels, duplicates, injection, refreshed lists, unavailable choices, and failures. Report router, resolver, selection, access/persistence, and probe outcomes separately, leaving live quality, cost, latency budgets, and cohort activation to master Phase 7.
- [x] Update sheet selection, file selection, semantic evaluation, incoming routing, conversation-state, FSM, observability, and feature-index documentation; synchronize the master tracking table with verified implementation evidence only after all checks pass.
- [x] Run the complete option-selection PostgreSQL/Redis suites and `pnpm test`; any skipped required suite remains pending evidence and blocks implementation completion.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Phase 3 is complete; review and commit the verified semantic option-selection delivery before starting the Phase 6 control-flow plan.
