# Plan: Semantic Router Shadow Pipeline

## Goal

Integrate ADR-023's semantic router as a bounded, observable shadow inside the current `process-message` worker without allowing model proposals to alter routing or business effects. Preserve deterministic behavior, queue compatibility, confirmation safety, and a flag-only rollback path while collecting privacy-safe evidence from messages that lexical ingress currently rejects.

## Context

- [Master plan, Phase 3](../2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md): Approved shadow-pipeline scope, contracts, and closure evidence.
- [Phase 1 evaluation plan](../2026_09_11-semantic_router_evaluation/2026_09_11-semantic_router_evaluation-plan.md) and [implemented evaluator behavior](../../../docs/features/semantic-router-evaluation.md): Provider-neutral proposal contract, strict OpenAI adapter, policy matrix, frozen corpus, and remaining live-evaluation limitations.
- [Phase 2 confirmation-safety plan](../2026_09_12-semantic_router_confirmation_safety/2026_09_12-semantic_router_confirmation_safety-plan.md) and [conversation-state management](../../../docs/features/conversation-state-management.md): Revisioned state, renewable ownership, operation bindings, financial claims, and stale-context behavior required before worker integration.
- [ADR-023](../../../docs/adr/ADR-023-constrained-llm-semantic-router.md), [ADR-011](../../../docs/adr/ADR-011-two-stage-pipeline.md), and [architecture decisions](../../../docs/adr/adr.md): Semantic authority boundary, placement after identity/lock/state loading, and the two-queue topology.
- [RouteIncomingMessage](../../../src/application/use-cases/conversation/RouteIncomingMessage.ts), [incoming worker](../../../src/interfaces/workers/incomingMessage.worker.ts), and [incoming routing documentation](../../../docs/features/incoming-message-routing.md): Current lexical pre-filter, deduplication, and FIFO admission behavior.
- [Message worker](../../../src/interfaces/workers/message.worker.ts), [worker registration](../../../src/bootstrap/registerWorkers.ts), and [dependency composition](../../../src/bootstrap/buildDependencies.ts): Current identity check, renewable per-user lock, current-state dispatch, and runtime wiring seams.
- [ProcessMessageJob](../../../src/application/ports/ProcessMessageJob.ts) and [IncomingMessageJob](../../../src/application/ports/IncomingMessageJob.ts): Strict queue trust boundaries that remain unchanged in this phase.
- [SemanticRouterPort](../../../src/domain/ports/SemanticRouterPort.ts), [semantic contracts](../../../src/application/services/semantic-router/contracts.ts), [state/action policy](../../../src/application/services/semantic-router/policy.ts), and [OpenAI adapter](../../../src/infrastructure/adapters/llm/OpenAISemanticRouterAdapter.ts): Reused Phase 1 contracts and provider implementation.
- [ConversationState](../../../src/domain/entities/ConversationState.ts), [TransitionConversationState](../../../src/application/use-cases/conversation/TransitionConversationState.ts), [clarification payload](../../../src/domain/value-objects/expense-clarification-state.ts), and [review payload](../../../src/domain/value-objects/expense-review-payload.ts): Persisted revision/expiry and validated sources for bounded context projection.
- [Environment schema](../../../src/config/env.schema.ts), [.env.example](../../../.env.example), [configuration documentation](../../../docs/architecture/config-env.md), [async pipeline](../../../docs/architecture/async-pipeline.md), [observability](../../../docs/architecture/observability.md), and [FSM states](../../../docs/architecture/fsm-states.md): Configuration, privacy, runtime, and state/substep documentation to keep synchronized.
- [Testing guidelines](../../../docs/testing/guidelines.md): Boundary mocking, real PostgreSQL/Redis integration coverage, FSM assertions, and mandatory negative side-effect checks.

### Revalidated prerequisites

- Phase 1 is implemented through `semantic-contract-v1`, `semantic-policy-v1`, `SemanticRouterPort.decide(input)`, `assessSemanticProposal`, the bounded `SemanticRouterInput`, and the strict OpenAI adapter. Offline development and held-out suites remain green, but no live provider evidence or production activation exists.
- Phase 2 is implemented through monotonic conversation revisions, renewable per-user ownership, state/action bindings, exact deterministic authorization commands, and claim-guarded financial effects. The required PostgreSQL/Redis concurrency and financial-context scenarios passed; migration `0009` still requires coordinated environment deployment outside this plan.
- `processMessageJob` already validates messaging identity before acquiring the per-user lock and loads state only after acquiring it. This is the only permitted runtime location for Phase 3 model calls.
- `RouteIncomingMessage` currently discards ordinary non-financial text in `IDLE` and `EXPENSE_RECEIVING`. Shadow evidence therefore requires cohort admission to `process-message`, followed by a deterministic baseline decision under the current locked state.
- No queue-contract change is required. Existing job fields provide stable user cohorting, per-message sampling, the original text, channel time, identity validation, and deduplication. Avoiding new job fields keeps old and new queued jobs compatible during flag rollback.

### Approved delivery boundaries

- Use three vertical deliveries: a runnable idle/receiving shadow slice, bounded projection across all currently policy-supported states, and rollback/evidence hardening.
- Shadow mode may call and assess the model, but the existing deterministic route executes exactly once and remains the only source of state transitions, messages, queue changes, saves, retries, and deletes.
- Inline callbacks, exact save confirmations, exact retry commands, and explicit immediate-undo commands bypass semantic interpretation. The model never observes or supplies authorization evidence.
- `enabled` is part of the configuration contract for later phases, but Phase 3 has no semantic action dispatcher. Any `enabled` resolution must return `ENABLED_CAPABILITY_UNAVAILABLE`, record a safe event, and execute the deterministic route. Phase 4 may replace this fail-closed behavior only for separately implemented and evaluated actions.
- The runtime OpenAI router is composed independently from the existing extraction-provider preference and from the standalone evaluator CLI. Missing credentials, unsupported models, invalid settings, timeouts, and provider failures never prevent deterministic processing.
- Default every state to `off`, default cohort and sampling percentages to zero, and require explicit non-secret configuration to spend provider capacity. Do not run a live provider or deploy flags as part of implementation verification.
- Use structured Pino events through an application-owned telemetry port. Do not persist raw messages, full state payloads, option identifiers, user identifiers, credentials, provider response bodies, or hidden reasoning in semantic telemetry.
- No database migration, new queue, new HTTP route, dependency installation, or product-answering behavior is included.

### Public contracts

#### Routing configuration and deterministic selection

Add application-owned contracts under `src/application/services/semantic-router/`:

```typescript
type SemanticRoutingMode = 'off' | 'shadow' | 'enabled';

interface SemanticRoutingConfig {
  readonly stateModes: Readonly<Partial<Record<FsmState, SemanticRoutingMode>>>;
  readonly cohortPercent: number;
  readonly shadowSamplePercent: number;
  readonly cohortSeed: string;
}

interface SemanticRoutingResolutionInput {
  readonly userId: string;
  readonly externalMessageId: string;
  readonly state: FsmState;
  readonly substep: string | null;
  readonly messageKind: 'free_text' | 'typed_callback' | 'sensitive_command';
  readonly providerAvailable: boolean;
}

type SemanticRoutingResolution =
  | { readonly mode: 'off'; readonly reason: 'state_off' | 'outside_cohort' | 'not_sampled' | 'deterministic_bypass' }
  | { readonly mode: 'shadow'; readonly cohortBucket: number; readonly sampleBucket: number }
  | { readonly mode: 'enabled'; readonly cohortBucket: number; readonly sampleBucket: number }
  | { readonly mode: 'unavailable'; readonly code: 'UNSUPPORTED_CONFIGURATION' | 'PROVIDER_UNAVAILABLE' | 'ENABLED_CAPABILITY_UNAVAILABLE' };

interface SemanticRoutingPolicy {
  admitsForObservation(userId: string): boolean;
  resolve(input: SemanticRoutingResolutionInput): SemanticRoutingResolution;
}
```

- Parse `SEMANTIC_ROUTER_STATE_MODES` as a strict comma-separated `STATE=mode` map with no duplicates or unknown states, `SEMANTIC_ROUTER_COHORT_PERCENT` and `SEMANTIC_ROUTER_SHADOW_SAMPLE_PERCENT` as integers from 0 through 100, and `SEMANTIC_ROUTER_COHORT_SEED` as a bounded non-secret identifier. Empty state modes and zero percentages preserve the current fully off behavior.
- Add bounded runtime adapter settings for provider, supported model snapshot, timeout, and output-token limit. Reuse `OpenAIRouterSettingsSchema`; cap the runtime timeout below the worker lease-renewal interval and do not infer router availability from the extraction provider.
- Derive stable cohort buckets from `(cohortSeed, userId)` and stable sampling buckets from `(cohortSeed, externalMessageId)`. Never log either raw input value.

#### Deterministic baseline and context validity

```typescript
type DeterministicRoutingDecision =
  | { readonly kind: 'fsm_handler' }
  | { readonly kind: 'expense_guidance' }
  | { readonly kind: 'typed_callback' }
  | { readonly kind: 'sensitive_command'; readonly command: 'save' | 'retry' | 'undo' }
  | { readonly kind: 'unsupported' };

interface DeterministicRoutingPolicy {
  decide(input: {
    readonly state: FsmState;
    readonly rawMessage: string;
    readonly hasCallback: boolean;
  }): DeterministicRoutingDecision;
}

type ConversationSnapshotCheck =
  | { readonly status: 'current'; readonly state: ConversationState }
  | { readonly status: 'stale' | 'expired' | 'missing' | 'operation_in_progress' };

interface ValidateConversationSnapshot {
  execute(input: {
    readonly userId: string;
    readonly expected: ConversationStatePrecondition;
  }): Promise<ConversationSnapshotCheck>;
}
```

- Move the existing `IDLE`/`EXPENSE_RECEIVING` lexical admission rule into this pure policy so the thick worker can reproduce guidance versus FSM handling from the state loaded under the lock. Reuse the exact existing cancel, undo, confirmation, and retry matchers; do not broaden their vocabulary.
- Implement snapshot validation as a read-only application service over `IConversationStateRepository`. Compare revision, state, expiry, and unresolved financial claim after the model returns. It performs no self-transition and creates no artificial revision.

#### Sanitized projection, orchestration, and telemetry

```typescript
type SemanticInputProjection =
  | { readonly status: 'supported'; readonly input: SemanticRouterInput }
  | { readonly status: 'unsupported'; readonly code: 'UNSUPPORTED_STATE' | 'UNSUPPORTED_SUBSTEP' | 'INVALID_STATE_CONTEXT' };

interface ProjectSemanticRouterInput {
  execute(input: {
    readonly rawMessage: string;
    readonly conversationState: ConversationState;
  }): SemanticInputProjection;
}

type SemanticPolicyOutcome =
  | 'allowed_shadow'
  | 'forbidden_action'
  | 'router_failure'
  | 'invalid_context'
  | 'stale_context'
  | 'deterministic_bypass'
  | 'not_sampled'
  | 'disabled'
  | 'enabled_capability_unavailable';

interface SemanticRoutingObservation {
  readonly event: 'semantic_router_observation';
  readonly mode: SemanticRoutingMode;
  readonly state: FsmState;
  readonly substep: string | null;
  readonly deterministicDecision: DeterministicRoutingDecision['kind'];
  readonly proposedAction: ConversationDecision['action'] | null;
  readonly policyOutcome: SemanticPolicyOutcome;
  readonly provider: string | null;
  readonly model: string | null;
  readonly promptVersion: string | null;
  readonly contractVersion: string;
  readonly policyVersion: string;
  readonly latencyMs: number | null;
  readonly errorCode: SemanticRouterErrorCode | 'STALE_CONTEXT' | 'INVALID_STATE_CONTEXT' | 'ENABLED_CAPABILITY_UNAVAILABLE' | null;
}

interface SemanticRoutingTelemetryPort {
  record(observation: SemanticRoutingObservation): void;
}

interface ObserveSemanticRouting {
  execute(input: {
    readonly userId: string;
    readonly externalMessageId: string;
    readonly rawMessage: string;
    readonly conversationState: ConversationState;
    readonly deterministicDecision: DeterministicRoutingDecision;
  }): Promise<SemanticRoutingObservation>;
}
```

- Project only Phase 1's allowlisted `pendingQuestion`, `missingFields`, expense summary, and displayed option positions/labels from validated state value objects. Never spread `statePayload`; omit operation IDs, revisions, queue metadata, provider IDs, raw historic messages, financial claims, and unknown fields.
- `ObserveSemanticRouting` resolves the mode, skips deterministic bypasses, projects input, makes at most one bounded `SemanticRouterPort.decide` call, validates the current snapshot, assesses the proposal, and records one sanitized event. It never receives use cases or repositories capable of business effects other than the read-only snapshot validator.
- In `shadow`, every router failure and policy rejection falls through to the precomputed deterministic decision without a new user-facing copy. Existing application-owned guidance and contextual copies remain authoritative.

## Phases

### Phase 1: Deliver an observable idle/receiving shadow slice

#### Description

Make previously filtered cohort messages observable end to end while retaining the exact deterministic result. This first delivery gives operators a runnable structured event for `IDLE` and `EXPENSE_RECEIVING` without enabling any semantic action.

#### To-do actions

- [x] Add strict environment parsing and tests for state modes, cohort percentage, sampling percentage, stable seed, provider/model settings, and bounded timeout/output limits. Update `.env.example` with safe off-by-default values and no credential content.
- [x] Implement and unit-test `SemanticRoutingPolicy` with deterministic SHA-256 cohort/sample buckets, state/substep allowlisting, callback and sensitive-command bypass, missing-provider fallback, and fail-closed `enabled` handling.
- [x] Extract `DeterministicRoutingPolicy` from the current lexical ingress behavior and prove parity for expense-like text, ordinary non-financial text, very long text, cancellation, explicit immediate undo, and exact financial authorization commands.
- [x] Change `RouteIncomingMessage` so users admitted to any semantic cohort enqueue all valid free text without reading state as an authoritative routing decision. Preserve the current direct deterministic filter when semantic observation is globally off or the user is outside the cohort.
- [x] Keep `IncomingMessageJobDataSchema` and `ProcessMessageJobDataSchema` unchanged. Mark a message processed only after successful durable enqueue; preserve duplicate external-message protection, callback identity rules, acknowledgments, and unsupported-message behavior.
- [x] Implement the minimal `IDLE`/`EXPENSE_RECEIVING` projection, read-only snapshot validation, `ObserveSemanticRouting`, and Pino telemetry adapter. Invoke observation in `processMessageJob` only after job validation, identity verification, lock acquisition, and current-state loading.
- [x] Await at most the configured router deadline, assess and record the proposal, then execute the deterministic decision exactly once. Assert that shadow decisions cannot call transition, messaging, queue, spreadsheet, expense, undo, retry, or delete dependencies.
- [x] Compose the runtime semantic adapter independently in `buildDependencies`, expose it through `Dependencies`, and inject it through `registerWorkers`; do not alter the standalone evaluator composition or existing extraction-provider precedence.
- [x] Add unit and worker tests proving that a lexically rejected bank notification can produce a shadow observation while receiving the same deterministic guidance, router failures still run the deterministic path once, and callbacks/sensitive commands make zero semantic calls.
- [x] Run focused tests plus `pnpm test`; no live provider call is part of the suite.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Project and observe every supported state safely

#### Description

Extend shadow observation across the existing `semantic-policy-v1` state/substep matrix using validated, minimal context while keeping deterministic state handlers authoritative.

#### To-do actions

- [x] Implement state-specific projectors for `EXPENSE_CLARIFYING`, `EXPENSE_REVIEW`, `EXPENSE_SAVING_RETRY`, `EXPENSE_UNDO_CONFIRMING`, `ONBOARDING_FILE`, and `ONBOARDING_SHEET`, including `idk` and `empty-sheet-confirm`. Unsupported processing/onboarding states and unknown substeps return a typed projection failure.
- [x] Parse each state payload through its canonical value object or strict local schema. Invalid or legacy-unbound context produces `INVALID_STATE_CONTEXT` and deterministic handling; never pass the raw payload or silently widen the action matrix.
- [x] Derive `allowedActions` only through `allowedActionsFor(state, substep)`. Preserve the original current-turn message and expose option labels/positions without provider identifiers or application-owned operation bindings.
- [x] Revalidate revision, current state, expiry, and financial-claim status after each model call. Record `stale_context` and discard the proposal if a timeout/OAuth/recovery writer, lease loss, or replacement state invalidates the captured snapshot.
- [x] Record one schema-validated telemetry event for proposed, forbidden, invalid, refused, timed-out, failed, unsupported, stale, disabled, and unsampled outcomes. Enforce metadata-only error logging and shared sensitive-field redaction.
- [x] Add projector contract tests for every allowed and unsupported state/substep, including malformed JSONB, oversized labels, duplicate option positions, prompt injection in labels, legacy review payloads, expired bindings, and unresolved financial claims.
- [x] Extend worker tests so deterministic clarification, review, selection, cancellation, retry, and undo behavior runs exactly once regardless of the shadow proposal. Assert zero semantic confirmation, append, retry, delete, state mutation, queue removal, or success copy.
- [x] Extend offline evaluator regressions with the runtime projector fixtures without changing frozen expected labels to accommodate implementation output. Record any intentionally unsupported context separately from model accuracy.
- [x] Run focused tests, both offline semantic corpus splits, and `pnpm test`; no live provider call is part of the suite.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Prove non-interference, compatibility, and rollback

#### Description

Close the pipeline with integration evidence that shadow traffic survives duplicates, contention, stale context, provider faults, and flag rollback while preserving deterministic outcomes and privacy.

#### To-do actions

- [ ] Add `semantic-router-shadow-pipeline.integration.spec.ts` with real PostgreSQL and Redis plus mocked messaging/model/spreadsheet boundaries. Cover a previously filtered notification, a deterministic expense, duplicate delivery, two messages for one user, identity mismatch, lock contention, lease loss, and a state revision changed while the model is pending.
- [ ] Prove provider timeout, refusal, invalid schema, forbidden action, unavailable credentials, unsupported configuration, and telemetry failure never suppress, duplicate, or redirect deterministic processing. Telemetry failure is logged safely and is non-fatal.
- [ ] Add an end-to-end webhook-to-worker regression that preserves HTTP acknowledgment and FIFO admission, emits one sanitized shadow observation, and produces the same user-visible result and state as off mode.
- [ ] Test rolling configuration from `shadow` to `off` with already queued messages. Because the job schemas remain unchanged and mode is resolved under the lock, old jobs must execute deterministically with no model call, no dead letter, and no migration.
- [ ] Test an `enabled` state entry before a dispatcher exists: emit `ENABLED_CAPABILITY_UNAVAILABLE`, execute the deterministic route once, and perform zero semantic effects. Document that later phases must explicitly replace this guard per action/state.
- [ ] Add log-capture assertions that semantic events contain provider/model and prompt/contract/policy versions, state/substep, deterministic/proposed outcomes, latency, and stable error code while excluding raw text, full payloads, option identifiers, operation IDs, revisions, credentials, provider bodies, hidden reasoning, and raw user/external IDs.
- [ ] Measure test-observed acknowledgment timing separately from bounded shadow latency and document that shadow agreement is not action accuracy or task-completion evidence. Keep production activation, real-provider sampling, numeric release gates, and controlled rollout pending Phase 7.
- [ ] Update `docs/features/incoming-message-routing.md`, `docs/features/semantic-router-evaluation.md`, `docs/features/README.md`, `docs/architecture/config-env.md`, `docs/architecture/async-pipeline.md`, `docs/architecture/observability.md`, and `docs/architecture/fsm-states.md` with implemented behavior, privacy limits, mode semantics, and rollback. Document only delivered behavior.
- [ ] Attach scenario counts, offline corpus results, zero unauthorized-effect observations, and any skipped external evidence to this plan and the master implementation table. Do not mark semantic actions or production activation delivered.
- [ ] Run the complete PostgreSQL/Redis integration suites and `pnpm test`; a skipped shadow-pipeline integration suite is pending evidence, not a passed gate.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Implement Phase 3 to prove non-interference, queue compatibility, privacy, and flag-only rollback with integration evidence.
