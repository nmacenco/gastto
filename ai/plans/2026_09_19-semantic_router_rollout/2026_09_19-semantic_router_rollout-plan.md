# Plan: Semantic Router Evaluation and Gradual Rollout

## Goal

Produce versioned, reviewable release evidence for the complete constrained semantic router, then activate it only through explicitly approved shadow and limited-cohort stages. Require measurable task-completion improvement, zero observed critical false authorizations or unauthorized effects, approved numeric budgets, and an exercised flag-only rollback before any expansion.

## Context

- [Master constrained semantic router plan](../2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md): Phase 7 scope, predecessor evidence, activation gates, and required separation between implementation verification, real-provider evaluation, and external rollout.
- [Phase 1 evaluation plan](../2026_09_11-semantic_router_evaluation/2026_09_11-semantic_router_evaluation-plan.md), [Phase 2 confirmation-safety plan](../2026_09_12-semantic_router_confirmation_safety/2026_09_12-semantic_router_confirmation_safety-plan.md), [Phase 3 shadow-pipeline plan](../2026_09_14-semantic_router_shadow_pipeline/2026_09_14-semantic_router_shadow_pipeline-plan.md), [Phase 4 expense-flow plan](../2026_09_15-semantic_router_expense_flows/2026_09_15-semantic_router_expense_flows-plan.md), [Phase 5 option-selection plan](../2026_09_16-semantic_router_option_selection/2026_09_16-semantic_router_option_selection-plan.md), and [Phase 6 control-flow plan](../2026_09_18-semantic_router_control_flows/2026_09_18-semantic_router_control_flows-plan.md): Implemented contracts and validation evidence to retain.
- [ADR-023](../../../docs/adr/ADR-023-constrained-llm-semantic-router.md): Required held-out evidence, numeric precommitted budgets, critical safety gate, shadow observation, task-completion comparison, staged activation, and rollback rules.
- [Architecture decisions](../../../docs/adr/adr.md), [ADR-011](../../../docs/adr/ADR-011-two-stage-pipeline.md), [ADR-017](../../../docs/adr/ADR-017-undo-confirmation-fsm.md), and [ADR-018](../../../docs/adr/ADR-018-user-initiated-save-retry.md): Queue ordering, deterministic undo authorization, and explicit retry boundaries.
- [Plan conventions](../../../docs/plans/plan-conventions.md) and [testing guidelines](../../../docs/testing/guidelines.md): Required plan structure, vertical delivery rules, boundary mocks, integration coverage, and negative side-effect assertions.
- [Semantic evaluator](../../../src/application/use-cases/evaluation/EvaluateSemanticRouter.ts), [evaluation CLI](../../../src/interfaces/cli/evaluateSemanticRouter.ts), [evaluation contracts](../../../src/application/use-cases/evaluation/contracts.ts), and [statistics](../../../src/application/use-cases/evaluation/statistics.ts): Existing offline/live proposal report, strict execution bounds, per-scope rates, latency, usage, and uncertainty utilities.
- [Semantic contracts](../../../src/application/services/semantic-router/contracts.ts), [state policy](../../../src/application/services/semantic-router/policy.ts), [runtime policy](../../../src/application/services/semantic-router/runtime-policy.ts), and [semantic turn orchestration](../../../src/application/services/semantic-router/ObserveSemanticRouting.ts): Current versions, state/substep gates, stable cohorting, deterministic bypasses, post-model preconditions, and enabled dispatch outcomes.
- [Semantic telemetry adapter](../../../src/infrastructure/observability/PinoSemanticRoutingTelemetry.ts), [observability documentation](../../../docs/architecture/observability.md), and [dependency composition](../../../src/bootstrap/buildDependencies.ts): Privacy-safe runtime observations and current log-only sink.
- [Message worker](../../../src/interfaces/workers/message.worker.ts), [expense dispatcher](../../../src/application/use-cases/expense/DispatchExpenseSemanticAction.ts), [option dispatcher](../../../src/application/use-cases/spreadsheet/DispatchOptionSelection.ts), and [control dispatcher](../../../src/application/use-cases/expense/DispatchControlSemanticAction.ts): Typed runtime handoffs whose outcomes must be covered by integrated acceptance evidence.
- [Semantic evaluation feature](../../../docs/features/semantic-router-evaluation.md), [incoming routing](../../../docs/features/incoming-message-routing.md), [configuration](../../../docs/architecture/config-env.md), and [FSM states](../../../docs/architecture/fsm-states.md): Canonical delivered behavior, pending live evidence, rollout switches, and persisted compatibility.
- [Versioned corpus](../../../evals/semantic-router/corpus.json), [response fixtures](../../../evals/semantic-router/corpus-responses.json), [freeze manifest](../../../evals/semantic-router/manifest.json), and [dataset instructions](../../../evals/semantic-router/README.md): Current `semantic-corpus-v6` / `semantic-labels-v6` evidence with 224 development and 53 held-out cases.
- [Deployment feature](../../../docs/features/deployment.md): Existing environment separation, worker deployment, rollback, and secret-handling procedures that the rollout runbook must reference rather than replace.

### Revalidation of Phases 1 through 6

- Phase 1 is implemented: `SemanticRouterPort.decide(input)` uses `semantic-contract-v2`, `semantic-policy-v3`, and `semantic-openai-v3`; `semantic-evaluation-v4` supports bounded offline and explicitly initiated live runs. The v6 fixture corpus passes 224/224 development and 53/53 held-out checks, but the manifest records no live evaluation and independent human label adjudication remains pending.
- Phase 2 is implemented: monotonic revisions, compare-and-swap state changes, successful-presentation bindings, expiry checks, and single-use financial claims reject stale, duplicated, replaced, or unresolved authorization before append or delete effects. The required PostgreSQL/Redis safety suites are part of the verified baseline.
- Phase 3 is implemented: routing mode is resolved after identity validation, lock acquisition, and current-state loading. `off` skips semantic calls, `shadow` cannot change routing, `enabled` fails closed for unavailable capabilities, and queued jobs resolve current flags after lock acquisition so rollback needs no queue or data migration.
- Phase 4 is implemented: expense recognition, missing-data completion, correction, and additional-expense queue admission retain original user text and application-owned state. Explicit save authorization remains deterministic and downstream extraction or correction failures do not become success.
- Phase 5 is implemented: semantic option references resolve only against the current ordered display snapshot. Ambiguous, unknown, or stale references have zero selection effects, while provider identifiers, configuration writes, and access validation remain application-owned.
- Phase 6 is implemented: semantic cancellation is state-bounded, inferred undo only presents a bound confirmation, inferred retry requests the exact deterministic retry command, and reconfiguration delegates only to the existing guarded recovery path. Seven PostgreSQL/Redis control scenarios, 2,216 passing tests, and the v6 offline splits are recorded in the master plan; no live provider or production cohort was activated.
- Current release-evidence gaps are explicit rather than silently inferred. `EvaluateSemanticRouter` leaves downstream task completion, unauthorized effects, full expense cost, production acknowledgment latency, and deterministic/candidate completion baselines unmeasured. Runtime telemetry records safe per-turn metadata but no versioned release threshold decision or aggregate completion report. Numeric budgets, Product Owner and Tech Lead approval, independent label review, real-provider evidence, shadow sample evidence, controlled-rollout evidence, and production activation all remain pending.
- No new semantic authority, FSM state, queue payload, provider-selected identifier, confirmation action, database migration, or webhook/API contract is planned. If aggregate outcome measurement cannot be added without user-level identifiers, raw messages, or a new persistence contract, stop and revise this plan before implementation.

### Approved delivery boundaries

- Use three deliveries: integrated implementation evidence, explicitly approved candidate and shadow evaluation, and separately authorized limited rollout plus rollback exercise.
- Plan creation and automated implementation verification do not authorize network calls, secret access, deployment, configuration changes, or production cohort activation.
- Freeze the dataset, independently review labels, record numeric budgets, and obtain Product Owner and Tech Lead approval before the first release-candidate evaluation. Do not derive thresholds from candidate results.
- Treat offline fixture agreement, mocked provider tests, and shadow agreement as different evidence classes. None substitutes for live model quality, downstream authorization safety, or controlled-rollout task completion.
- Require zero observed critical false authorizations and zero unauthorized effects. Report denominators and uncertainty; never describe a zero count as proof of zero production risk.
- Compare deterministic and enabled cohorts using the same aggregate task-start and terminal-outcome definitions. Count duplicate delivery, queued expenses, retries, cancellations, timeouts, and unresolved outcomes consistently so task completion cannot be inflated.
- Compute model cost per completed expense only from measured router, extraction, and correction usage plus an approved, versioned pricing input. Missing usage or pricing makes the cost gate incomplete, never zero.
- Preserve the current one-second acknowledgment target separately from post-ack semantic latency. Report p95 by state/provider with sample counts and an explicit insufficient-sample status.
- Emit or ingest only aggregate-safe rollout evidence. Exclude raw messages, option labels, expense values, full state payloads, credentials, provider bodies, hidden reasoning, user IDs, chat IDs, external message IDs, operation IDs, and reversible hashes of them.
- Keep state modes, cohort percentage, shadow sampling percentage, model snapshot, timeout, and output-token cap explicit in every stage. Expansion is manual and state-bounded; a provider being configured never authorizes activation.
- Roll back the affected states to `off` on any observed false authorization, unauthorized side effect, breached approved budget, unresolved telemetry gap, or operator stop. Preserve deterministic commands, current reviews, bindings, pending expenses, retries, undo offers, and in-flight job compatibility.
- Do not edit or overwrite a frozen evidence bundle. A model, prompt, contract, policy, dataset, threshold, or pricing change creates a new candidate and reruns all applicable gates.

### Proposed file ownership

- `src/application/use-cases/evaluation/release-contracts.ts`: Strict schemas for approved thresholds, aggregate observations, evidence inputs, gate results, and the versioned acceptance report.
- `src/application/use-cases/evaluation/EvaluateSemanticRouterRelease.ts`: Pure release-gate aggregation and fail-closed decision logic over existing proposal reports plus implementation, shadow, and rollout evidence.
- `src/interfaces/cli/evaluateSemanticRouterRelease.ts` and `package.json`: Offline-only command that reads explicit artifacts, writes a new report without overwriting, and performs no provider, database, Redis, or application-bootstrap access.
- `src/application/services/semantic-router/rollout-telemetry.ts`, `src/infrastructure/observability/PinoSemanticRoutingTelemetry.ts`, and relevant expense/option/control completion boundaries: Aggregate-safe eligibility, terminal outcome, usage, latency, and safety observations required for cohort comparison.
- `src/application/use-cases/evaluation/*.{spec.ts}` and existing colocated telemetry, worker, dispatcher, authorization, and CLI specifications: Hand-computable metrics, invalid evidence, version drift, privacy, and gate behavior.
- Existing E2E and PostgreSQL/Redis suites plus a focused `tests/integration/semantic-router-release-acceptance.integration.spec.ts`: Cross-capability conversations, critical zero-effect assertions, restart/timeout behavior, and flag-only rollback.
- `evals/semantic-router/releases/README.md`, `evals/semantic-router/releases/templates/*`, and immutable `evals/semantic-router/releases/<candidate-id>/` bundles: Threshold template, evidence manifest, checksums, owner approvals, reports, and rollout records without secrets or raw financial data.
- `docs/features/semantic-router-evaluation.md`, `docs/features/incoming-message-routing.md`, `docs/features/deployment.md`, `docs/architecture/config-env.md`, `docs/architecture/fsm-states.md`, `docs/architecture/observability.md`, and `docs/features/README.md`: Implemented release-evidence and rollout behavior, ownership, stop conditions, and remaining external status.
- [Master plan](../2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md) and applicable files under `docs/user-stories/`: Tracking links and acceptance checkboxes updated only from verified evidence, never from plan approval alone.

### Public contracts

#### Precommitted release thresholds

```ts
interface SemanticRouterReleaseThresholds {
  readonly schemaVersion: 'semantic-release-thresholds-v1';
  readonly thresholdVersion: string;
  readonly candidate: {
    readonly provider: 'openai';
    readonly model: string;
    readonly promptVersion: string;
    readonly contractVersion: string;
    readonly policyVersion: string;
    readonly datasetVersion: string;
    readonly labelVersion: string;
  };
  readonly approvedBy: {
    readonly productOwner: string;
    readonly techLead: string;
    readonly approvedAt: string;
  };
  readonly minimums: {
    readonly heldOutCases: number;
    readonly shadowSamplesByScope: number;
    readonly enabledTaskStartsByScope: number;
    readonly observationWindowHours: number;
  };
  readonly gates: {
    readonly minimumActionAccuracyByScope: Readonly<Record<string, number>>;
    readonly minimumAmbiguityDetectionByScope: Readonly<Record<string, number>>;
    readonly maximumUnnecessaryClarificationByScope: Readonly<Record<string, number>>;
    readonly maximumSchemaFailureRate: number;
    readonly maximumP95RouterLatencyMsByScope: Readonly<Record<string, number>>;
    readonly maximumAcknowledgmentP95Ms: number;
    readonly maximumCostPerCompletedExpense: number;
    readonly minimumTaskCompletionLift: number;
    readonly maximumCriticalFalseAuthorizations: 0;
    readonly maximumUnauthorizedEffects: 0;
  };
  readonly pricing: {
    readonly version: string;
    readonly currency: string;
    readonly effectiveAt: string;
    readonly source: string;
    readonly rates: Readonly<Record<string, { inputPerMillion: number; outputPerMillion: number }>>;
  };
}
```

- The repository provides and validates a template, but implementation must not invent numeric values, approver identities, or prices. The immutable candidate threshold artifact is supplied and approved before live evaluation begins.
- Threshold values must be finite, bounded, internally consistent, and complete for every proposed state/substep activation scope. An absent scope, approval, price, or minimum sample requirement produces `blocked_missing_evidence`.
- The candidate tuple is exact. Aliases, later model snapshots, changed prompts/contracts/policies, and changed label or dataset versions require a new threshold version and approval.

#### Aggregate-safe rollout observations

```ts
type SemanticRolloutEvidenceKind =
  | 'eligible_task_started'
  | 'task_completed'
  | 'task_cancelled'
  | 'task_timed_out'
  | 'task_failed'
  | 'task_outcome_unknown'
  | 'router_call'
  | 'extraction_call'
  | 'correction_call'
  | 'false_authorization_observed'
  | 'unauthorized_effect_observed';

interface SemanticRolloutObservation {
  readonly schemaVersion: 'semantic-rollout-observation-v1';
  readonly evidenceKind: SemanticRolloutEvidenceKind;
  readonly occurredAt: string;
  readonly releaseId: string;
  readonly deploymentVersion: string;
  readonly environment: 'test' | 'staging' | 'production';
  readonly mode: 'off' | 'shadow' | 'enabled';
  readonly cohort: 'deterministic' | 'candidate';
  readonly state: string;
  readonly substep: string | null;
  readonly capability: 'expense' | 'option_selection' | 'control';
  readonly outcomeCode: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly promptVersion: string | null;
  readonly contractVersion: string;
  readonly policyVersion: string;
  readonly latencyMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}
```

- The same deterministic application boundary defines eligible starts and terminal outcomes for both cohorts. Aggregate counts, not identity-bearing event correlation, are the release metric contract.
- Duplicate webhook delivery and repeated callbacks must not add task starts or completions. Pending-queue items count once when admitted as distinct tasks. Retry, cancellation, timeout, and unknown outcomes retain separate terminal codes and documented denominator treatment.
- Router, extraction, and correction usage is recorded separately so the report can calculate complete expense cost. If any required call lacks usage, cost completeness is false and the cost gate cannot pass.
- Existing `semantic_router_observation` remains the per-turn routing event. Extend it only with aggregate-safe release metadata needed to reconcile counts; do not add identity-bearing fields.

#### Versioned acceptance report

```ts
type ReleaseGateStatus = 'passed' | 'failed' | 'blocked_missing_evidence';

interface SemanticRouterAcceptanceReport {
  readonly schemaVersion: 'semantic-acceptance-report-v1';
  readonly releaseId: string;
  readonly generatedAt: string;
  readonly sourceVersion: string;
  readonly thresholdVersion: string;
  readonly evidenceDigests: Readonly<Record<string, string>>;
  readonly candidate: SemanticRouterReleaseThresholds['candidate'];
  readonly evidence: {
    readonly implementation: ReleaseGateStatus;
    readonly offlineDevelopment: ReleaseGateStatus;
    readonly offlineHeldOut: ReleaseGateStatus;
    readonly liveHeldOut: ReleaseGateStatus;
    readonly shadow: ReleaseGateStatus;
    readonly controlledRollout: ReleaseGateStatus;
    readonly rollbackExercise: ReleaseGateStatus;
  };
  readonly metrics: {
    readonly perScopeActionAccuracy: Readonly<Record<string, { numerator: number; denominator: number }>>;
    readonly ambiguityDetection: Readonly<Record<string, { numerator: number; denominator: number }>>;
    readonly unnecessaryClarification: Readonly<Record<string, { numerator: number; denominator: number }>>;
    readonly schemaFailures: { numerator: number; denominator: number };
    readonly p95RouterLatencyMsByScope: Readonly<Record<string, { value: number | null; samples: number }>>;
    readonly acknowledgmentP95Ms: { value: number | null; samples: number };
    readonly taskCompletionByCohort: Readonly<Record<'deterministic' | 'candidate', { completed: number; eligible: number }>>;
    readonly costPerCompletedExpense: { value: number | null; currency: string; usageComplete: boolean };
    readonly criticalFalseAuthorizationCount: number;
    readonly unauthorizedEffectCount: number;
  };
  readonly gates: ReadonlyArray<{
    readonly name: string;
    readonly status: ReleaseGateStatus;
    readonly reasonCodes: readonly string[];
  }>;
  readonly decision: 'approved_for_next_stage' | 'hold' | 'rollback';
}
```

- The evaluator verifies artifact checksums and exact candidate versions, preserves numerator/denominator/sample counts, and reports uncertainty where meaningful. It never rewrites input evidence or overwrites an existing report.
- Any critical false authorization or unauthorized effect forces `rollback`. Missing evidence, insufficient samples, incomplete cost, unapproved thresholds, or version drift forces `hold`; no average metric may override those results.
- `approved_for_next_stage` authorizes only the next documented stage, not production-wide enablement. The final rollout record still requires explicit external approval.

#### Rollout and rollback record

```ts
interface SemanticRouterRolloutRecord {
  readonly schemaVersion: 'semantic-rollout-record-v1';
  readonly releaseId: string;
  readonly stage: 'shadow' | 'limited_enabled' | 'expanded_enabled' | 'rolled_back';
  readonly states: readonly string[];
  readonly cohortPercent: number;
  readonly shadowSamplePercent: number;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly observationWindowHours: number;
  readonly accountableOwner: string;
  readonly technicalOperator: string;
  readonly approvalReference: string;
  readonly priorConfigurationDigest: string;
  readonly appliedConfigurationDigest: string;
  readonly acceptanceReportDigest: string;
  readonly stopReason: string | null;
  readonly rollbackVerifiedAt: string | null;
}
```

- Records contain no secret values. The runbook names exact environment variables, validation commands, observation windows, owners, stop conditions, and the recoverable previous configuration without copying credentials into the repository.
- Rollback changes affected state modes to `off` first, verifies already queued work resolves the new mode after lock acquisition, and confirms deterministic exact commands and active payloads remain usable. It does not edit database migrations or rewrite queued jobs/state payloads.
- A rollout record may remain pending when external execution has not been authorized. Documentation and the master table must distinguish implemented release tooling from live evidence, limited activation, and production completion.

## Phases

### Phase 1: Deliver integrated release evidence and a fail-closed acceptance report

#### Description

Create a runnable, offline release-evidence command and complete automated cross-capability acceptance suite. This delivery makes the current implementation, safety, offline quality, rollout-metric definitions, and missing external evidence visible in one versioned report without contacting a provider or activating routing.

#### To-do actions

- [x] Add strict release-threshold, aggregate-observation, evidence-manifest, rollout-record, and acceptance-report schemas with exact version tuples, bounded numeric fields, checksum validation, and privacy-safe field allowlists.
- [x] Implement `EvaluateSemanticRouterRelease` as a pure aggregator over existing semantic reports and explicit implementation/runtime evidence. Preserve numerators, denominators, uncertainty, sample sufficiency, evidence class, and missing-data reasons; never coerce null or absent evidence to zero.
- [x] Add `pnpm eval:semantic-router:release` with explicit `--thresholds`, `--manifest`, `--output`, and evidence-file arguments. It must run without dotenv, application bootstrap, database, Redis, or network access; reject unknown/incompatible arguments and existing outputs; and use exit `0` only for the requested next-stage gate, `1` for failed gates, and `2` for invalid or incomplete evidence.
- [x] Add aggregate-safe start, terminal-outcome, model-call usage, critical authorization, and unauthorized-effect observations at application-owned boundaries shared by deterministic and semantic cohorts. Keep current per-turn telemetry behavior and verify no sensitive or identity-bearing value enters either event contract.
- [x] Define task-completion denominators for direct, clarified, corrected, queued, cancelled, timed-out, failed, retried, duplicated, and unknown-outcome expenses. Define option and control acceptance separately so they cannot inflate completed-expense counts.
- [x] Consolidate automated conversations spanning bank-notification recognition, missing-data clarification, correction, displayed file/sheet selection, explicit confirmation and append, two-item queue advancement, cancellation, timeout/grace, inferred and delayed undo, request-only retry, exact retry, reconfiguration, restart, duplicate delivery, lock contention, lease loss, and enabled-to-shadow/off rollback.
- [x] Assert no local expense record or success message after failed/unknown append, no delete/audit success after invalid or failed undo authorization, no semantic append/delete/confirmation authority, no selection/config effect from unresolved options, and no replacement of unresolved financial claims.
- [x] Exercise the full version matrix and fail closed on prompt, contract, policy, dataset, label, pricing, source, or deployment drift. Add hand-computable report tests for zero denominators, insufficient samples, incomplete usage, unknown outcomes, critical failure, and mixed passed/blocked evidence.
- [x] Run focused unit, CLI, worker, E2E, and PostgreSQL/Redis tests, both frozen offline splits, and the complete suite. Record exact scenario/test counts and artifact digests; do not label fixture replay as model accuracy.
- [x] Create release-evidence templates and documentation for independent label review, numeric Product Owner/Tech Lead budget approval, immutable candidate bundles, privacy review, and external evidence import. Leave approver identities, thresholds, prices, and live results unset until supplied by authorized owners.
- [x] Update semantic evaluation, incoming routing, configuration, FSM, observability, deployment, and feature-index documentation for the implemented evidence tooling only. Keep real-provider, shadow, and activation statuses visibly pending.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Evaluate the approved candidate and validate shadow readiness

#### Description

After the dataset labels, numeric budgets, pricing, provider/model snapshot, resource limits, and owners are explicitly approved, collect real held-out and shadow evidence for that exact candidate. This delivery may authorize only a limited enabled stage; it does not deploy or activate one by itself.

#### To-do actions

- [ ] Stop before external execution unless an immutable threshold artifact includes Product Owner and Tech Lead approval, the independently reviewed held-out labels are frozen, the exact provider/model snapshot is supported, the pricing input and maximum spend are approved, and the user authorizes network calls with explicit case/token/time limits.
- [ ] Capture a deterministic baseline over the same state/substep scopes, task-start definitions, observation window rules, acknowledgment target, and terminal-outcome taxonomy planned for the candidate. Record unavailable scopes rather than estimating them.
- [ ] Run a bounded live development smoke first, then the frozen held-out set exactly once for the candidate unless an approved rerun reason creates a new evidence record. Preserve refusals, truncations, timeouts, schema failures, usage, latency, and incomplete runs; never repair labels or silently retry to improve results.
- [ ] Calculate per-state action accuracy, ambiguity handling, unnecessary clarification, schema failure, p50/p95 router latency, token usage, projected router cost, critical false authorization, and uncertainty with sample counts. Keep end-to-end task completion and full expense cost pending until controlled enabled evidence exists.
- [ ] Configure approved states in `shadow` with the approved stable cohort seed and sampling percentage. Verify no model-driven transition, message, queue mutation, selection, append, retry, reconfiguration, delete, audit success, or success copy occurs from a shadow proposal.
- [ ] Collect the minimum approved shadow samples by scope and reconcile aggregate-safe observations against processing counts. Investigate missing, duplicated, malformed, or version-mismatched telemetry as a blocking evidence defect.
- [ ] Exercise shadow-to-off rollback with queued messages and active clarification, review, file/sheet selection, retry, and undo-confirming payloads. Confirm post-change jobs make no semantic call and deterministic paths need no migration or payload rewrite.
- [ ] Generate an immutable acceptance report and require every implementation, offline, live, shadow, critical-safety, latency, schema, and sample gate to pass. A missing full-cost or enabled task-completion gate may approve only `limited_enabled`, never expansion.
- [ ] Record the candidate bundle, checksums, commands, spend, model/provider, prompt/contract/policy versions, dataset/label versions, source/deployment version, dates, owners, report decision, and remaining evidence without committing credentials, raw cases from production, or provider response bodies.
- [ ] Update canonical evaluation, routing, configuration, observability, and deployment documentation plus the feature index with verified candidate and shadow evidence. Keep activation pending until a separate external rollout approval is recorded.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Run a controlled rollout and exercise production rollback

#### Description

With a passing candidate/shadow report and explicit deployment authorization, enable the smallest approved state/cohort slice, compare actual task completion and full expense cost against the deterministic baseline, and either expand one stage or roll back. This delivery closes Phase 7 only when the rollout evidence and rollback exercise are attached; otherwise external activation remains pending.

#### To-do actions

- [ ] Require a signed rollout record before configuration change: exact states, initial cohort percentage, observation window, minimum samples, accountable owner, technical operator, approval reference, prior configuration digest, candidate report digest, dashboard/query links, communication path, and stop/rollback conditions.
- [ ] Start with the smallest approved low-risk capability/state cohort and retain a contemporaneous deterministic comparison cohort. Do not enable every delivered state at once, change the model/prompt/policy during the window, or reuse evidence across version changes.
- [ ] Validate deployment health, worker compatibility, provider availability, telemetry completeness, acknowledgment p95, router p95, schema failures, clarification behavior, critical safety events, queue health, task starts, terminal outcomes, and model usage before and throughout the observation window.
- [ ] Measure enabled task completion against the deterministic baseline using identical eligibility and terminal-outcome definitions. Calculate full model cost per completed expense from router, extraction, and correction usage; block expansion when usage, pricing, samples, or completion denominators are incomplete.
- [ ] Require zero observed critical false authorizations and zero unauthorized effects. Immediately set affected state modes to `off` on either event, any approved budget breach, missing safety telemetry, incompatible version drift, unresolved operator concern, or manual stop.
- [ ] Exercise rollback during the controlled window with already queued work and active review, pending queue, selection, retry, undo-confirming, and unresolved-claim contexts. Verify new work follows deterministic routing, no semantic provider calls occur in `off`, and existing exact commands and bound actions remain usable without migration, dead letter, duplicate effect, or payload rewrite.
- [ ] Re-run the release report after the complete observation window. Permit only one explicitly approved expansion step when task completion improves by the precommitted threshold, all budgets remain met, uncertainty and sample requirements are satisfied, critical safety stays green, and rollback evidence passes.
- [ ] Record every stage transition, configuration digest, time window, sample count, metric, incident, stop reason, owner decision, and rollback result in the immutable rollout bundle. Do not backfill missing production evidence from tests or shadow observations.
- [ ] Update the semantic evaluation, incoming routing, deployment, configuration, FSM, observability, and feature-index documentation with actual verified status. Mark pending states/cohorts as pending and document the active rollback configuration.
- [ ] Update the master tracking table and applicable user-story acceptance criteria only after evidence is implemented and verified. Distinguish release tooling complete, candidate evaluated, shadow validated, limited rollout complete, expanded activation, and rolled-back states.
- [ ] Run the complete automated suite, frozen regressions, release-report validation, `pnpm test`, and the required PostgreSQL/Redis suites against the released source before closing the stage. Any skipped required suite or missing external record blocks completion.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

After explicit approval of independently reviewed labels, numeric Product Owner/Tech Lead thresholds, pricing, provider limits, and network execution, complete Phase 2 to collect bounded live held-out and shadow evidence without activating an enabled cohort.
