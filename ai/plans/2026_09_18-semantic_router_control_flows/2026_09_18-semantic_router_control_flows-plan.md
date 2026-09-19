# Plan: Semantic Router Control Flows

## Goal

Enable state-bounded semantic cancellation, inferred undo requests, retry requests, and spreadsheet reconfiguration while preserving deterministic authorization for deletion and append effects. Natural undo must always present a bound confirmation, natural retry must require the existing exact retry command, and all off, shadow, rollback, queue, expiry, and financial-claim protections must remain intact.

## Context

- [Master constrained semantic router plan](../2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md): Phase 6 scope, prerequisites, approved authority boundaries, and closure evidence.
- [Phase 1 evaluation plan](../2026_09_11-semantic_router_evaluation/2026_09_11-semantic_router_evaluation-plan.md), [Phase 2 confirmation-safety plan](../2026_09_12-semantic_router_confirmation_safety/2026_09_12-semantic_router_confirmation_safety-plan.md), [Phase 3 shadow-pipeline plan](../2026_09_14-semantic_router_shadow_pipeline/2026_09_14-semantic_router_shadow_pipeline-plan.md), [Phase 4 expense-flow plan](../2026_09_15-semantic_router_expense_flows/2026_09_15-semantic_router_expense_flows-plan.md), and [Phase 5 option-selection plan](../2026_09_16-semantic_router_option_selection/2026_09_16-semantic_router_option_selection-plan.md): Implemented predecessor contracts and verification evidence to retain.
- [ADR-023](../../../docs/adr/ADR-023-constrained-llm-semantic-router.md): Closed proposal vocabulary, state policy, deterministic execution, confirmation boundaries, and activation gates.
- [ADR-017](../../../docs/adr/ADR-017-undo-confirmation-fsm.md) and [ADR-018](../../../docs/adr/ADR-018-user-initiated-save-retry.md): One-message immediate undo eligibility, delayed undo confirmation, and the single user-initiated save retry.
- [Plan conventions](../../../docs/plans/plan-conventions.md), [architecture decisions](../../../docs/adr/adr.md), and [testing guidelines](../../../docs/testing/guidelines.md): Required plan shape, architectural constraints, test placement, boundary mocks, and negative effect assertions.
- [Semantic contracts](../../../src/application/services/semantic-router/contracts.ts), [state policy](../../../src/application/services/semantic-router/policy.ts), [input projection](../../../src/application/services/semantic-router/ProjectSemanticRouterInput.ts), and [runtime policy](../../../src/application/services/semantic-router/runtime-policy.ts): Existing control proposal vocabulary, state/substep allowlist, sanitized contexts, and fail-closed enabled-state gate.
- [Semantic turn orchestration](../../../src/application/services/semantic-router/ObserveSemanticRouting.ts), [deterministic routing](../../../src/application/services/semantic-router/deterministic-routing.ts), and [worker routing](../../../src/interfaces/workers/message.worker.ts): Current expense/option enabled outcomes, sensitive-command bypasses, dispatch telemetry, and deterministic control handlers.
- [Cancellation](../../../src/application/use-cases/expense/CancelExpenseRegistrationUseCase.ts), [undo](../../../src/application/use-cases/expense/UndoLastExpense.ts), [save retry](../../../src/application/use-cases/expense/RetryExpenseSaveUseCase.ts), and [reconfiguration](../../../src/application/use-cases/spreadsheet/StartSpreadsheetReconfigurationUseCase.ts): Existing effect-owning use cases and recovery boundaries.
- [Expense copies](../../../src/application/copies/expense.copies.ts) and [intent normalization](../../../src/application/utils/intents.ts): Existing cancellation, undo, retry, recovery, and exact-command copy contracts.
- [Expense cancellation](../../../docs/features/expense-cancellation.md), [undo last expense](../../../docs/features/undo-last-expense.md), [expense confirmation and recovery](../../../docs/features/expense-confirmation.md), [conversation state](../../../docs/features/conversation-state-management.md), and [incoming routing](../../../docs/features/incoming-message-routing.md): Canonical functional behavior to preserve and extend.
- [FSM states](../../../docs/architecture/fsm-states.md), [configuration](../../../docs/architecture/config-env.md), and [observability](../../../docs/architecture/observability.md): Persisted payloads, activation controls, and privacy-safe telemetry.
- [Semantic evaluation feature](../../../docs/features/semantic-router-evaluation.md), [evaluation corpus](../../../evals/semantic-router/corpus.json), [manifest](../../../evals/semantic-router/manifest.json), and [dataset instructions](../../../evals/semantic-router/README.md): Versioned evaluation contracts and current evidence.
- [Dependency composition](../../../src/bootstrap/buildDependencies.ts): Construction point for semantic dispatchers and capability-availability gates.

### Revalidation of Phases 1 through 5

- Phase 1 is present: `semantic-contract-v2`, `semantic-policy-v2`, and `semantic-openai-v2` validate a single provider-neutral proposal. The closed vocabulary already contains `cancel_current_flow`, `undo_last_expense`, `request_save_retry`, and `request_reconfiguration`; none currently grants an effect by itself.
- Phase 2 is present: conversation states use monotonic decimal-string revisions, compare-and-swap transitions, successful-presentation bindings, expiry checks, and single-use financial execution claims. Undo confirmation and retry reject stale, expired, unbound, replaced, duplicate, or in-progress operations before provider effects.
- Phase 3 is present: semantic resolution occurs after identity validation, lock acquisition, and current-state loading. Off and shadow retain deterministic execution; enabled unsupported capabilities fail closed; post-model snapshot checks reject changed context; queue schemas remain unchanged for flag-only rollback.
- Phase 4 is present: enabled expense dispatch revalidates the captured precondition, retains original messages, preserves queue ordering/capacity, and leaves explicit save authorization deterministic. Cancellation proposals remain unavailable to that dispatcher.
- Phase 5 is present: enabled option dispatch resolves only revision-bound displayed positions and preserves provider IDs, access checks, persistence, and eager validation inside application-owned paths. The current manifest is `semantic-corpus-v5` / `semantic-labels-v5` with 196 development and 41 held-out cases.
- The Phase 5 source, manifest, corpus, and integration evidence agree, but `evals/semantic-router/README.md` still describes v4 label/split provenance. Phase 6 must correct that drift before documenting its next dataset version.
- Remaining Phase 6 gaps: enabled orchestration has no control-action outcome or dispatcher; `EXPENSE_CORRECTING` has no semantic projection; exact undo confirmation and exact `reconfigurar` are not both classified as sensitive bypasses; inferred undo provenance is not explicit in the undo input; and enabled retry proposals cannot yet produce a request-only handoff.
- No database, migration, HTTP, webhook, BullMQ job, provider-port, or persisted payload change is planned. If implementation discovers that current revision, action binding, expiry, or execution-claim fields cannot enforce these boundaries, stop and revise this plan before adding persistence.

### Approved delivery boundaries

- Permit `cancel_current_flow` only in `EXPENSE_RECEIVING`, `EXPENSE_CLARIFYING`, `EXPENSE_REVIEW`, and `EXPENSE_CORRECTING`. It cancels only the active expense draft, never onboarding, a retry claim, an undo confirmation, or a saved expense.
- Permit `undo_last_expense` only in `IDLE`. The application creates semantic provenance; the model cannot claim explicit-command provenance or provide an immediate-undo expense ID. Every inferred undo enters a newly bound `EXPENSE_UNDO_CONFIRMING` offer even when one-message immediate eligibility exists.
- Preserve direct deletion only for the existing exact deterministic undo command with valid immediate eligibility. Exact confirmation in `EXPENSE_UNDO_CONFIRMING` remains a deterministic, bound, later-than-presentation authorization path.
- Permit `request_save_retry` and `request_reconfiguration` only in a valid, unexpired `EXPENSE_SAVING_RETRY` context with no execution claim. An inferred retry sends the existing request for exact `reintentar`; it never invokes `RetryExpenseSaveUseCase` or appends a row.
- A validated semantic reconfiguration request may invoke only `StartSpreadsheetReconfigurationUseCase` for the active Google configuration. It cannot replay the retained expense, change the retry limit, select another file, or bypass normal access validation and column inference.
- Classify exact cancellation, undo, retry, undo-confirmation, and `reconfigurar` commands before semantic interpretation. Typed callbacks and financial confirmations continue to bypass the provider.
- Revalidate state, revision, expiry, payload shape, and execution-claim absence immediately before every semantic control handoff. Unknown, ambiguous, mixed, stale, malformed, unsupported, failed, or lease-lost turns produce bounded application-owned guidance and zero cancellation, deletion, append, queue, configuration, or success-message effects.
- Preserve cancellation cleanup-before-copy ordering, pending-expense FIFO advancement, undo external-delete-before-local-success ordering, latest-record identity checks, single retry attempt, unknown-outcome claims, and existing audit semantics.
- Preserve off/shadow deterministic behavior and flag-only rollback with jobs and active control states already in flight. Do not enable a production cohort, run a live provider evaluation, or claim release readiness in this plan.

### State and substep capability matrix

| State / substep                     | Enabled control proposals                       | Required behavior                                                                                    |
| ----------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `IDLE/default`                      | `undo_last_expense`                             | Offer bound delayed undo; never consume immediate eligibility as semantic authorization.             |
| `EXPENSE_RECEIVING/default`         | `cancel_current_flow`                           | Clear only the active draft, send cancellation copy, then advance FIFO if present.                   |
| `EXPENSE_CLARIFYING/default`        | `cancel_current_flow`                           | Clear clarification payload, preserve queue ordering, then advance FIFO if present.                  |
| `EXPENSE_REVIEW/default`            | `cancel_current_flow`                           | Require a current successfully presented review snapshot, cancel only that draft, then advance FIFO. |
| `EXPENSE_CORRECTING/default`        | `cancel_current_flow`                           | Validate the correction payload, cancel the active draft, and perform no correction call.            |
| `EXPENSE_SAVING_RETRY/default`      | `request_save_retry`, `request_reconfiguration` | Retry proposal requests exact `reintentar`; reconfiguration delegates only to existing recovery.     |
| `EXPENSE_UNDO_CONFIRMING/default`   | Guidance only                                   | Confirmation and cancellation remain exact deterministic commands; no semantic deletion authority.   |
| All other states / unknown substeps | None                                            | Fail closed or keep the existing deterministic route according to mode.                              |

### Proposed file ownership

- `src/application/services/semantic-router/control-capabilities.ts`: Control decision types, enabled capability matrix, and state checks.
- `src/application/services/semantic-router/policy.ts`, `ProjectSemanticRouterInput.ts`, `runtime-policy.ts`, and `ObserveSemanticRouting.ts`: State allowlist, sanitized correction/retry contexts, enabled control outcome, deterministic bypasses, and dispatch telemetry lifecycle.
- `src/application/services/semantic-router/deterministic-routing.ts`: Exact sensitive-command classification, including bound undo confirmation and `reconfigurar`.
- `src/application/use-cases/expense/DispatchControlSemanticAction.ts`: Snapshot revalidation and one typed cancellation, undo-offer, retry-prompt, or reconfiguration handoff.
- `src/application/use-cases/expense/PresentUndoConfirmation.ts`: Shared binding, expiry, delivery, and successful-presentation logic for deterministic delayed and semantic undo requests.
- `src/application/use-cases/expense/CancelExpenseRegistrationUseCase.ts` and `UndoLastExpense.ts`: Semantic cancellation source and application-owned request provenance without changing effect authorization.
- `src/application/use-cases/spreadsheet/StartSpreadsheetReconfigurationUseCase.ts`: Captured-precondition support for semantic recovery handoff.
- `src/application/copies/expense.copies.ts`, `src/interfaces/workers/message.worker.ts`, and `src/bootstrap/buildDependencies.ts`: Controlled copies, outcome rendering, deterministic fallback, and dependency composition.
- Existing colocated specifications plus `tests/integration/semantic-router-control-flows.integration.spec.ts`: Unit, worker, PostgreSQL/Redis, rollback, and zero-effect evidence.
- `evals/semantic-router/*` and the canonical cancellation, undo, recovery, routing, conversation-state, FSM, observability, and feature-index documentation listed in Context.

### Public contracts

#### Control capability and semantic handoff

```ts
type ControlSemanticDecision = Extract<
  ConversationDecision,
  | { readonly action: 'cancel_current_flow' }
  | { readonly action: 'undo_last_expense' }
  | { readonly action: 'request_save_retry' }
  | { readonly action: 'request_reconfiguration' }
>;

interface SemanticControlProvenance {
  readonly kind: 'semantic_proposal';
  readonly sourceMessageId: string;
}

interface DispatchControlSemanticActionInput {
  readonly userId: string;
  readonly externalId: string;
  readonly channel: 'telegram' | 'whatsapp';
  readonly conversationState: ConversationState;
  readonly expected: ConversationStatePrecondition;
  readonly decision: ControlSemanticDecision;
  readonly provenance: SemanticControlProvenance;
}

type ControlGuidanceReason =
  | 'stale_context'
  | 'invalid_state_context'
  | 'unsupported_action'
  | 'ambiguous_intent'
  | 'mixed_intents'
  | 'dispatch_failed';

type DispatchControlSemanticActionOutcome =
  | { readonly status: 'cancelled' }
  | { readonly status: 'undo_confirmation_presented'; readonly pendingExpenseId: string }
  | { readonly status: 'undo_unavailable' }
  | { readonly status: 'explicit_command_required'; readonly command: 'reintentar' }
  | { readonly status: 'reconfiguration_started' }
  | { readonly status: 'clarification_required'; readonly reason: ControlGuidanceReason };

interface DispatchControlSemanticAction {
  execute(input: DispatchControlSemanticActionInput): Promise<DispatchControlSemanticActionOutcome>;
}
```

- `ObserveSemanticRouting` returns `control_action` only after schema, state/substep allowlist, capability, and post-model snapshot checks. It carries the application-created provenance and captured precondition; provider output contains neither.
- `DispatchControlSemanticAction` validates the captured snapshot again and selects exactly one typed branch. It never exposes repositories, spreadsheet ports, action bindings, claims, revisions, or identifiers to the model.
- `request_save_retry` returns `explicit_command_required` and sends recovery guidance. The only call site for `RetryExpenseSaveUseCase.execute` remains the later exact deterministic `reintentar` branch.
- Control dispatch observations reuse `allowed_enabled`, `dispatch_rejected`, and `dispatch_failed`; they must omit raw text, expense details, user/external IDs, bindings, claims, configuration identifiers, provider bodies, and reasoning.

#### Explicit versus inferred undo provenance

```ts
type UndoLastExpenseInput =
  | {
      readonly userId: string;
      readonly action: 'request';
      readonly provenance: 'deterministic_command';
      readonly immediateExpenseId?: string;
    }
  | {
      readonly userId: string;
      readonly action: 'request';
      readonly provenance: 'semantic_request';
    }
  | {
      readonly userId: string;
      readonly action: 'confirm';
      readonly pendingExpenseId: string;
      readonly authorization: { readonly receivedAt: string; readonly sourceMessageId: string };
    };

interface PresentUndoConfirmationInput {
  readonly userId: string;
  readonly chatId: string;
  readonly expense: {
    readonly id: string;
    readonly concepto: string;
    readonly monto: number;
    readonly moneda: string;
    readonly savedAt: Date;
  };
  readonly expected: ConversationStatePrecondition;
}

type PresentUndoConfirmationOutcome =
  | { readonly status: 'presented'; readonly pendingExpenseId: string }
  | { readonly status: 'unbound'; readonly pendingExpenseId: string }
  | { readonly status: 'stale' };
```

- `semantic_request` always returns `confirmation_required`; it cannot accept or derive `immediateExpenseId`.
- `deterministic_command` preserves ADR-017 direct deletion only when the current immediate token equals the latest non-deleted expense. Existing queued-review behavior remains deterministic and re-presents the active review after the undo outcome.
- `PresentUndoConfirmation` extracts the existing binding/presentation sequence from the worker: persist an unpresented operation binding and five-minute expiry, send the existing confirmation copy, and set `presentedAt` only after successful delivery. Failed delivery remains unbound and can never authorize deletion.
- Confirmation still consumes the exact current binding into a claim, rechecks the latest record, deletes externally first, and completes the local soft-delete/audit transaction only after provider success.

#### Cancellation and reconfiguration preconditions

```ts
interface SemanticCancellationInput extends CancelExpenseRegistrationInput {
  readonly source: 'semantic';
  readonly expected: ConversationStatePrecondition;
}

interface StartSpreadsheetReconfigurationInput {
  readonly userId: string;
  readonly chatId: string;
  readonly channel: 'telegram' | 'whatsapp';
  readonly expected?: ConversationStatePrecondition;
}
```

- Semantic cancellation commits `IDLE` only from the captured active expense state/revision and then uses the existing queue-advance path. Deterministic text and callback inputs remain compatible.
- Semantic reconfiguration supplies the captured retry-state precondition. Existing deterministic `reconfigurar` remains compatible, but it is classified as a sensitive bypass before provider invocation.
- Reconfiguration may transition only through the existing Google recovery path to `ONBOARDING_VALIDATING_ACCESS`; missing/unsupported configuration uses the existing safe expiry response and no expense replay.

#### Application-owned copies and versioning

- Reuse exact existing copies for successful cancellation, no active expense, undo offer/cancel/expiry/failure, retry request, stale financial action, unknown financial outcome, and reconfiguration failure.
- Add and test these bounded Spanish control copies:
  - Ambiguous or mixed control request: `No me quedó claro qué querés hacer. Pedime una sola acción.`
  - Retry recovery choice: `Respondé *reintentar* para volver a guardar o *reconfigurar* para revisar la planilla.`
  - Stale or unsupported control request: `Esa solicitud ya no corresponde al estado actual. Revisá la conversación e intentá de nuevo.`
- Select copies from application state and policy outcome, never from provider-generated prose.
- Bump policy and prompt versions when the allowed-action matrix changes. Keep `semantic-contract-v2` if the serialized provider schemas remain unchanged; bump it only if implementation changes their shape. Create a new corpus/label version for Phase 6 additions, update manifest hashes and split counts, and repair the stale v4 provenance text before recording the new version.

## Phases

### Phase 1: Deliver the control policy, provenance boundary, and executable evaluation slice

#### Description

Define control capabilities and application-owned provenance, preserve every exact sensitive-command bypass, and make the new state/action matrix visible through the offline evaluator before enabling any semantic control effect.

#### To-do actions

- [x] Add `ControlSemanticDecision`, `SemanticControlProvenance`, and the control capability matrix for `IDLE`, active expense states, `EXPENSE_SAVING_RETRY`, and guidance-only `EXPENSE_UNDO_CONFIRMING`; reject every unknown substep and all processing/onboarding states not listed above.
- [x] Extend `EXPENSE_CORRECTING/default` projection only after validating its persisted correction payload. Expose no raw payload, concept, binding, revision, claim, source message, queue item, or provider identifier.
- [x] Refine deterministic routing so exact cancel, undo, review save, retry, bound undo confirmation, and `reconfigurar` inputs are sensitive bypasses before a provider call. Preserve typed callbacks and option-specific deterministic bypasses.
- [x] Introduce the discriminated `UndoLastExpenseInput` provenance contract and update deterministic callers without changing runtime behavior. Unit-test that only `deterministic_command` can consume matching immediate eligibility and that `semantic_request` always returns `confirmation_required`.
- [x] Extend the offline corpus with independently labeled Spanish control families covering paraphrases, regional wording, typos, negation, conditional requests, mixed cancel/undo/retry intents, stale-state variants, prompt injection, and every allowed/forbidden state pair.
- [x] Add critical expectations that no semantic output authorizes save, retry, undo confirmation, deletion, arbitrary reconfiguration, or a raw FSM transition. Report control action agreement, ambiguity handling, policy rejection, and false-authorization counts separately from end-to-end effects.
- [x] Correct the current v5 provenance drift in `evals/semantic-router/README.md`, then version and freeze the Phase 6 corpus/labels/manifest before inspecting candidate results. Keep independent human review and live-provider evidence visibly pending.
- [x] Bump policy/prompt/dataset versions as required, keep the contract version unchanged unless its serialized schema changes, and update schema, adapter, manifest, corpus, and report tests consistently.
- [x] Run focused semantic contract, policy, projection, deterministic-routing, evaluator, corpus, and adapter tests plus both offline dataset splits. Do not run a live provider evaluation or activate a cohort.
- [x] Update `docs/features/semantic-router-evaluation.md`, `docs/features/incoming-message-routing.md`, `docs/architecture/fsm-states.md`, `docs/architecture/observability.md`, and `docs/features/README.md` for the delivered policy/evaluation behavior only.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Enable semantic cancellation and confirmation-only inferred undo

#### Description

Dispatch natural cancellation within the exact active-draft boundary and turn every inferred undo into a bound, successfully presented confirmation without weakening immediate deterministic undo or latest-record deletion checks.

#### To-do actions

- [x] Add `control_action` to `SemanticRoutingTurnOutcome`, enabled capability checks, pending dispatch telemetry, and `recordControlDispatch`; retain one finalized observation per turn and fail closed when the dispatcher is unavailable.
- [x] Implement `DispatchControlSemanticAction` snapshot revalidation and cancellation branches for receiving, clarifying, review, and correcting states. Pass semantic source plus the captured precondition into `CancelExpenseRegistrationUseCase` and invoke no extractor, correction interpreter, save, retry, undo, or reconfiguration dependency.
- [x] Preserve cancellation cleanup-before-copy ordering, null payload/expiry, no saved-record mutation, and exact FIFO advancement. Assert review replacement, queue overflow, stale revision, lease loss, financial claims, malformed payloads, and unsupported states cannot cancel or advance anything.
- [x] Extract `PresentUndoConfirmation` from the current worker flow and reuse it for deterministic delayed and semantic undo requests. Persist the binding before delivery, set `presentedAt` only after success, preserve the five-minute expiry, and leave failed delivery unbound.
- [x] Dispatch `undo_last_expense` only from `IDLE` with `semantic_request` provenance and no immediate ID. Even with a valid one-message token, present the current latest expense in `EXPENSE_UNDO_CONFIRMING` and perform zero provider deletion or local soft delete.
- [x] Preserve exact immediate undo, queued-review immediate undo, delayed exact confirmation, exact cancellation of an undo offer, expiry, latest-record replacement rejection, external-delete-before-local-success ordering, transactional audit, and unknown-outcome claim behavior.
- [x] Add worker and use-case tests for natural cancellation in all four active states, cancellation with zero/one/two queued expenses, inferred undo with and without immediate eligibility, failed offer delivery and safe re-presentation, mixed requests, stale proposals, lost leases, expired/replaced targets, duplicate confirmation, provider deletion failure, and zero premature success copy.
- [x] Add the first PostgreSQL/Redis control-flow scenarios for revision-bound cancellation, FIFO advancement, inferred undo confirmation, immediate explicit undo preservation, concurrent confirmation, and no deletion before the later exact authorization.
- [x] Update `docs/features/expense-cancellation.md`, `docs/features/undo-last-expense.md`, `docs/features/conversation-state-management.md`, `docs/features/incoming-message-routing.md`, `docs/architecture/fsm-states.md`, `docs/architecture/observability.md`, and `docs/features/README.md` with the delivered behavior and remaining recovery TODOs.
- [x] Run focused tests and `pnpm test`; keep retry/reconfiguration semantic dispatch, live evaluation, and production activation pending.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Enable request-only retry and bounded recovery, then prove rollback safety

#### Description

Complete control dispatch by turning natural retry into an exact-command prompt, restricting semantic reconfiguration to the existing recovery use case, and verifying the complete control slice across persistence, queues, claims, failures, evaluation, and flag-only rollback.

#### To-do actions

- [ ] Implement `request_save_retry` so a valid semantic proposal sends the application-owned retry guidance and retains the current retry state/binding. Assert it never calls `RetryExpenseSaveUseCase`, `RegisterExpense.save`, a spreadsheet append, expense persistence, queue mutation, or a success copy.
- [ ] Preserve exact later `reintentar` authorization: require a successfully presented binding, later channel timestamp, unexpired current retry payload, no execution claim, and one attempt only. Repeated, stale, legacy-unbound, expired, replaced, and unknown-outcome requests perform zero append effects.
- [ ] Implement `request_reconfiguration` through `StartSpreadsheetReconfigurationUseCase` with the captured retry-state precondition. Preserve Google-only configuration lookup, transition to `ONBOARDING_VALIDATING_ACCESS`, eager access validation, missing-config fallback, and zero retained-expense replay.
- [ ] Treat exact `reconfigurar` as a deterministic sensitive command and keep it usable in off, shadow, enabled, provider-failure, and rollback modes. Reject the same proposal outside valid retry recovery without configuration or state mutation.
- [ ] Map ambiguous, mixed, stale, unsupported, provider-failed, and dispatcher-failed control turns to the approved bounded copies. Assert zero append, delete, cancellation, queue advancement, reconfiguration, audit-success, or success-message effects for every rejected path.
- [ ] Complete `tests/integration/semantic-router-control-flows.integration.spec.ts` with named PostgreSQL/Redis scenarios for cancellation plus FIFO advancement, inferred undo despite immediate eligibility, exact immediate undo, bound delayed deletion, expired/replaced/failed deletion, request-only retry then one exact append, repeated retry rejection, reconfiguration scope, unresolved claims, duplicate delivery, lock contention, lease loss, and enabled-to-shadow/off rollback with jobs in flight.
- [ ] Extend end-to-end worker coverage for both channels where shared contracts apply. Verify each accepted proposal produces one router call and at most one typed control handoff, while exact sensitive commands produce zero router calls.
- [ ] Extend offline development and held-out control families and report per-state agreement, ambiguity, policy rejection, unnecessary clarification, critical false authorization, unauthorized-effect results, call counts, and remaining live latency/cost/task-completion evidence. Do not define Phase 7 release budgets or authorize activation.
- [ ] Exercise flag-only rollback with active review, retry, and undo-confirming payloads. Existing deterministic exact commands, bindings, expiry, queue items, and claims must remain usable without payload rewrites, migration, dead letters, duplicate effects, or provider calls in `off`.
- [ ] Update `docs/features/expense-confirmation.md`, `docs/features/expense-cancellation.md`, `docs/features/undo-last-expense.md`, `docs/features/conversation-state-management.md`, `docs/features/incoming-message-routing.md`, `docs/features/semantic-router-evaluation.md`, `docs/architecture/fsm-states.md`, `docs/architecture/config-env.md`, `docs/architecture/observability.md`, and `docs/features/README.md`; update the master tracking table only after all implementation evidence passes.
- [ ] Run the complete PostgreSQL/Redis control-flow suite and `pnpm test`; any skipped control-flow scenario remains pending evidence and blocks Phase 6 completion.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Implement Phase 3 to enable request-only semantic retry and bounded spreadsheet recovery, then prove flag-only rollback safety.
