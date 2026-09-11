# Master Plan: Constrained Semantic Router

## Goal

Deliver ADR-023 through seven independently reviewable subplans, each covering a runnable or user-visible vertical slice. Improve conversational interpretation while preserving deterministic authorization, persisted FSM rules, and safe rollback.

## Context

- [ADR-023](../../../docs/adr/ADR-023-constrained-llm-semantic-router.md): Accepted decision, initial scope, authority boundaries, and activation gates.
- [AGENTS.md](../../../AGENTS.md) and [plan conventions](../../../docs/plans/plan-conventions.md): Repository rules and normal-plan structure.
- [Previous master plan](../2026_09_02-master_linked_subcategories/2026_09_02-master_linked_subcategories-plan.md): Reference for phase-triggered subplan creation.
- [Architecture decisions](../../../docs/adr/adr.md), [ADR-011](../../../docs/adr/ADR-011-two-stage-pipeline.md), [ADR-017](../../../docs/adr/ADR-017-undo-confirmation-fsm.md), and [ADR-018](../../../docs/adr/ADR-018-user-initiated-save-retry.md): Provider independence, queue processing, immediate undo, and explicit retry limits.
- [RouteIncomingMessage](../../../src/application/use-cases/conversation/RouteIncomingMessage.ts): Existing early financial-intent filter and processing-queue admission.
- [Message worker](../../../src/interfaces/workers/message.worker.ts): Identity validation, per-user lock, current-state dispatch, clarification, review, and recovery integration.
- [ProcessMessageJob](../../../src/application/ports/ProcessMessageJob.ts): Strict queued-message and callback trust boundary.
- [LLM ports](../../../src/domain/ports/services.ts) and [dependency composition](../../../src/bootstrap/buildDependencies.ts): Existing extraction/correction contracts and provider wiring.
- [Review reply resolver](../../../src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase.ts): Existing confirmation, correction, and additional-expense precedence.
- [Sheet selection](../../../src/application/use-cases/spreadsheet/HandleSheetSelection.ts): Current selection and eager access-validation behavior.
- [Incoming routing](../../../docs/features/incoming-message-routing.md), [clarification](../../../docs/features/clarification-request.md), [expense confirmation](../../../docs/features/expense-confirmation.md), and [expense correction](../../../docs/features/expense-correction.md): Existing financial conversation contracts.
- [File selection](../../../docs/features/select-spreadsheet-file.md), [sheet selection](../../../docs/features/select-sheet.md), [cancellation](../../../docs/features/expense-cancellation.md), and [undo](../../../docs/features/undo-last-expense.md): Selection and control-flow boundaries.
- [FSM states](../../../docs/architecture/fsm-states.md), [data model](../../../docs/architecture/data-model.md), and [configuration](../../../docs/architecture/config-env.md): State payloads, persistence, and runtime configuration.
- [Testing guidelines](../../../docs/testing/guidelines.md): Required transition coverage, boundary mocks, and negative side-effect assertions.

### Approved scope and contracts

- Use a separate provider-neutral `SemanticRouterPort.decide(input)` contract for a single structured proposal. Exact DTO definitions and signatures are finalized in the relevant subplan.
- Use ADR-023's closed decision vocabulary, with a state/substep allowlist and controlled clarification reasons. Do not add semantic confirmation or generated product answers.
- Retain original messages for extraction, correction, and missing-data interpretation. Model-generated selectors and external display labels remain untrusted.
- Keep save, undo-confirmation, and save-retry authorization on deterministic whole-message commands or typed callbacks. Preserve the explicit immediate-undo exception; inferred undo always offers confirmation.
- Preserve correction-versus-new-expense precedence, queue limits, pending-expense ordering, timeout semantics, and success messages derived from actual operation results.
- Support `off`, `shadow`, and `enabled` routing modes by state and rollout cohort. A provider's availability does not imply activation.
- Keep internal orchestration inside the modular monolith without MCP. Product-question answering and semantic confirmation require separate follow-up decisions.
- Do not assume a database migration is required. Phase 2 must determine the persisted revision strategy from current state writers; any necessary change must be additive, schema-first, and backward-compatible.
- Build automated tests with mocked external boundaries. Real-model evaluations are separate, explicitly initiated operations with approved data and budgets, never part of ordinary unit tests.

### How to use this master plan

Each phase triggers creation of one normal plan using `create-plan`; it is not a direct instruction to implement that phase. The triggers below are ready-to-use prompts. Write each child plan under `ai/plans/{creation_date}-{slug}/{creation_date}-{slug}-plan.md`, using the actual creation date and the listed stable slug.

Before creating a child plan, revalidate its bounded code scope and predecessor contracts. Reuse approved decisions, resolve remaining implementation choices against current source, and follow the skill's normal contract/phase agreement step. Approval of this master authorizes this document only; writing or implementing child plans requires the corresponding user request.

Prefer just-in-time planning after predecessors are implemented and verified. A child plan may be drafted earlier if requested, but must list unimplemented dependencies and be revalidated before execution. Every child must contain Goal, linked Context, vertical Phases, exact public contracts, named test scenarios, documentation updates, and Next step.

Master checkboxes track planning requirements: checking one means the child plan contains that requirement, not that application behavior exists. Track implementation separately below, with links to validation evidence. Never mark the overall feature delivered merely because all child plans exist.

| Phase | Stable child-plan slug | Implementation prerequisites | Plan created | Implementation verified |
| --- | --- | --- | --- | --- |
| 1 | `semantic_router_evaluation` | None | Pending | Pending |
| 2 | `semantic_router_confirmation_safety` | Phase 1 contracts | Pending | Pending |
| 3 | `semantic_router_shadow_pipeline` | Phases 1 and 2 | Pending | Pending |
| 4 | `semantic_router_expense_flows` | Phases 1 through 3 | Pending | Pending |
| 5 | `semantic_router_option_selection` | Phases 1 through 4 | Pending | Pending |
| 6 | `semantic_router_control_flows` | Phases 1 through 5 | Pending | Pending |
| 7 | `semantic_router_rollout` | Phases 1 through 6 | Pending | Pending |

### Shared implementation gates

- Each implemented child leaves the application buildable and existing deterministic paths usable. Integrations remain disabled or in shadow until the relevant activation gates pass.
- Define focused tests and require `pnpm test`, `pnpm run lint`, and `pnpm run typecheck` for implementation completion. Test core policy directly and mock only external boundaries.
- Document only delivered behavior in canonical feature files; keep future behavior explicitly marked as TODO with a destination. Synchronize `docs/features/README.md` or `docs/adr/README.md` whenever files in those directories change.
- Maintain the state/substep matrix, dataset, and regression scenarios as each capability is added. Read current source when documentation disagrees, including clarification timeouts and undo-state coverage; do not silently change runtime behavior to match stale documentation.
- Numeric activation thresholds must be established against the baseline before candidate evaluation, as required by ADR-023. Zero false authorizations in the critical suite is necessary, not proof of zero production risk.
- Do not run the app, modify application code, or run implementation gates merely to create a plan. The final lint/typecheck tasks below are requirements to carry into each child's implementation phases; documentation-only validation checks plan structure, links, and whitespace.

## Phases

### Phase 1: Create the evaluator and semantic-contract subplan

#### Description

Plan a runnable evaluation tool that compares deterministic routing and validated semantic proposals on labeled conversation examples. Its first delivery provides a report the user can inspect without enabling conversational effects.

**Trigger:** `$create-plan Create the normal plan for Phase 1 of ai/plans/2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md, using the slug semantic_router_evaluation. Create the plan only.`

**Public contracts:** `ConversationDecision`; minimal `SemanticRouterInput`; `SemanticRouterPort.decide(input): Promise<SemanticRouterResult>`; typed provider/schema failures; versioned evaluation case and report formats. Result metadata includes model/provider and prompt/contract versions without financial text.

**Closure evidence:** A documented evaluator command, reproducible fixture report, contract tests, and baseline definitions. No model proposal can execute a business action from the tool.

#### To-do actions

- [ ] Create and link the normal plan, recording the approved contract names and concrete signatures.
- [ ] Define the strict decision schema, state/substep action matrix, input projection, and error taxonomy from ADR-023; disabled actions remain unavailable.
- [ ] Plan one initial provider adapter compatible with existing composition, with bounded input/output sizes, timeout, strict output validation, and no autonomous iterations. Document capability checks and explicit fallback for unsupported provider configurations.
- [ ] Define the evaluator command and fixtures with raw example text, state/substep, safe context, expected intent or accepted outcomes, authorization expectation, and scenario labels.
- [ ] Separate development and held-out cases, record dataset versions and counts, and make reports distinguish action accuracy from actual task completion.
- [ ] Cover regional Spanish, typos, negation, mixed intents, corrections containing amounts, new expenses, ambiguous references, injection, malformed output, unknown actions, forbidden actions, and provider failures.
- [ ] Measure the current router's baseline and specify reporting for per-state accuracy, ambiguity, unnecessary clarification, schema failures, latency, and model usage/cost. Do not present fixture timing as production latency.
- [ ] Keep normal automated evaluation offline; specify a separate opt-in real-provider evaluation workflow that does not read secret files or persist raw financial conversations in reports.
- [ ] Require documentation of the implemented evaluator and its limitations, plus the corresponding feature index update.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Create the confirmation and context-validity subplan

#### Description

Plan an independently testable improvement to deterministic confirmations and stale-context rejection before model decisions can affect live flows. Keep existing explicit commands usable while tying callbacks and pending actions to the operation actually presented.

**Trigger:** `$create-plan Create the normal plan for Phase 2 of ai/plans/2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md, using the slug semantic_router_confirmation_safety. Revalidate Phase 1 contracts and create the plan only.`

**Public contracts:** Pending-operation/review identity and revision; callback payload validation and presentation contracts; state-update preconditions and stale/expired outcomes; application-owned expired-review copy. Define any required repository signature and additive schema change only after inspecting every relevant state writer.

**Closure evidence:** Old buttons cannot confirm a corrected or replacement expense, expiry invalidates pending actions, and overlapping state writers cannot commit a decision against superseded context.

#### To-do actions

- [ ] Create and link the normal plan after tracing review creation, correction, save, timeout, OAuth, callback, and recovery state writers.
- [ ] Define operation/revision binding for newly presented summaries, invalidation after corrections, and the exact whole-message command policy.
- [ ] Specify backward-compatible handling of existing JSONB and queued callbacks; reject unbound legacy confirmation safely when its target cannot be established and provide a current review.
- [ ] Define stale callback rejection across parser, queue DTO, presenter, and application action resolver as one complete vertical change.
- [ ] Choose and justify locking or conditional-update behavior for all competing writers, including timeout and OAuth paths, and specify lock-expiry behavior during a slow model request.
- [ ] If needed, plan an additive schema-first migration and repository precondition contract, including local migration verification and data-model documentation. Do not invent a migration solely to reserve future fields.
- [ ] Specify tests for corrected summaries, same-state replacement operations, duplicate callbacks, expiration, lock contention/expiry, racing writers, legacy payloads, and mixed affirmative/correction messages with zero accidental saves or deletions.
- [ ] Preserve delayed-undo target checks and explicit retry limits; no semantic confirmation action is introduced.
- [ ] Require updates to affected confirmation and conversation-state documentation and indexes.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Create the shadow-pipeline integration subplan

#### Description

Plan end-to-end observation of incoming messages under the processing worker's current-state context, with model proposals unable to affect routing in shadow mode.

**Trigger:** `$create-plan Create the normal plan for Phase 3 of ai/plans/2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md, using the slug semantic_router_shadow_pipeline. Revalidate Phases 1 and 2 and create the plan only.`

**Public contracts:** Routing mode/cohort configuration; deterministic policy input/outcome; sanitized state-context projection; structured telemetry fields and error codes; necessary queue admission metadata with strict compatibility rules.

**Closure evidence:** Shadow reports include examples previously filtered out at ingestion, actual business outcomes remain deterministic, and the model runs only after identity checks and lock acquisition.

#### To-do actions

- [ ] Create and link the normal plan with the exact integration and dependency-composition points.
- [ ] Define `off / shadow / enabled` configuration per state and cohort, defaulting to `off`, including unsupported-provider behavior and rollback handling for already queued messages.
- [ ] Adapt ingestion so candidate messages reach processing without lexical pre-rejection or a stale authoritative state decision; specify deduplication and acknowledgment behavior for admitted and sampled messages.
- [ ] Keep all model calls out of the single-concurrency incoming worker. Load state under the per-user lock and use Phase 2 preconditions before accepting a proposal.
- [ ] Preserve deterministic processing exactly once in shadow mode; suppress model-driven state changes, messages, writes, and deletes. Bound sampling and provider timeouts so observation cannot indefinitely delay processing.
- [ ] Define application-owned fallback for unknown, forbidden, invalid, timed-out, and failed proposals. Deterministic sensitive commands are checked independently before semantic interpretation.
- [ ] Record provider/model, prompt/contract version, state, proposed action, policy outcome, latency, and stable error code; prohibit raw text, full payloads, credentials, and hidden reasoning.
- [ ] Specify tests for filtered-message sampling, duplicate delivery, identity mismatch, lock contention, changed context, disabled mode, shadow non-interference, rollback with jobs in flight, and privacy-safe error reporting.
- [ ] Require routing feature, configuration, FSM policy, and index updates for the behavior actually delivered.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 4: Create the expense-flow integration subplan

#### Description

Plan the first conversational capability: recognizing expenses, answering missing-data questions, and correcting an active review while retaining deterministic save authorization and pending-expense behavior.

**Trigger:** `$create-plan Create the normal plan for Phase 4 of ai/plans/2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md, using the slug semantic_router_expense_flows. Revalidate Phases 1 through 3 and create the plan only.`

**Public contracts:** Typed proposal dispatch to registration, clarification, and review use cases; correction/new-expense/clarification outcomes; controlled guidance copies. Preserve original-message input and existing extraction/correction field contracts unless a concrete compatibility change is required.

**Closure evidence:** Scenario-driven conversations reach a correct review with fewer lexical failures, and confirmation still saves only the explicitly reviewed expense.

#### To-do actions

- [ ] Create and link the normal plan with explicit allowed actions for `IDLE`, `EXPENSE_RECEIVING`, `EXPENSE_CLARIFYING`, and `EXPENSE_REVIEW`, plus any internal substeps.
- [ ] Route expense recognition to existing interpretation, missing-data replies to contextual completion, and corrections to the active review using application-retained original text.
- [ ] Define `register_expense` in an active review as additional-expense queue admission rather than immediate replacement or saving; preserve existing clarification interruption rules separately.
- [ ] Resolve ownership between semantic intent classification and existing correction interpretation so conflicting second classifications cannot redirect an already validated action. Bound and measure necessary extraction calls.
- [ ] Preserve category/subcategory invariants, zero/high-amount confirmations, correction-cycle limits, pending-queue capacity and ordering, and save/retry payload continuity.
- [ ] Keep `sí, pero cambia el importe a 25` on the correction path with a new review; unresolved mixed intents cause controlled clarification without writes.
- [ ] Specify tests for short missing-data answers, new-expense interruptions, amount-bearing corrections, unrelated text, queue overflow with unchanged review, legacy payloads, failed extraction, and explicit save of the corrected amount exactly once.
- [ ] Extend held-out evaluations and define per-state activation prerequisites. Implemented capability does not automatically enable its cohort.
- [ ] Require routing, clarification, review/correction/confirmation documentation and relevant index updates.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 5: Create the option-selection subplan

#### Description

Plan natural references to displayed files and sheets with deterministic, unique resolution against the exact option snapshot presented to the user.

**Trigger:** `$create-plan Create the normal plan for Phase 5 of ai/plans/2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md, using the slug semantic_router_option_selection. Revalidate Phases 1 through 4 and create the plan only.`

**Public contracts:** Ordered option snapshot and revision; `ResolveOptionReference` input; `resolved / ambiguous / not_found / stale` result; typed selection handoff to current file/sheet use cases; application-owned selection clarification copies.

**Closure evidence:** Ordinal and normalized-label selections resolve uniquely, ambiguous or stale references have no selection effects, and downstream access checks remain authoritative.

#### To-do actions

- [ ] Create and link the normal plan after inspecting current file discovery, search, sheet selection, and substep behavior.
- [ ] Define the bounded model-facing labels/positions and separate application-owned identifier mapping; model output never supplies trusted provider IDs.
- [ ] Resolve ordinals against the displayed ordering and labels against documented normalization, rejecting zero or multiple matches, duplicate labels, out-of-range positions, and stale snapshots.
- [ ] Specify compatibility for existing option payloads, pagination/search changes, refreshed lists, and selected-file changes during interpretation.
- [ ] Preserve single-sheet behavior, unknown-selection guidance, header-description requests, empty-sheet confirmation, authorization, and deterministic eager advance; classify selection effects separately from automatic validation probes.
- [ ] Ensure a validated selection reaches a typed application entry point without being reinterpreted by a conflicting lexical matcher.
- [ ] Specify tests for ordinal and label references, duplicate names, injection in option labels, refreshed lists, stale replies, unavailable choices, selection failure, and access-validation errors.
- [ ] Extend per-state evaluations and keep unrelated onboarding configuration mutations outside this selection capability.
- [ ] Require file/sheet selection, FSM payload/policy, and feature index updates.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 6: Create the control-flow subplan

#### Description

Plan state-bounded cancellation, inferred undo requests, and recovery proposals while keeping deletion and retry authorization explicit.

**Trigger:** `$create-plan Create the normal plan for Phase 6 of ai/plans/2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md, using the slug semantic_router_control_flows. Revalidate Phases 1 through 5 and create the plan only.`

**Public contracts:** Control-action policy outcomes; explicit-command versus inferred-request provenance; pending undo/retry handoff; controlled clarification and recovery copy. Extend existing application use-case inputs only where required to carry validated intent and prevent authorization escalation.

**Closure evidence:** Natural undo requests offer confirmation without deleting, explicit immediate undo preserves ADR-017 eligibility, and inferred retry requests cannot append a row.

#### To-do actions

- [ ] Create and link the normal plan with state/substep scope for cancellation, undo request, retry request, and reconfiguration request.
- [ ] Preserve cancellation's active-draft boundary, queue advancement after cancellation, and no-active-flow response; do not infer onboarding cancellation from the generic action name.
- [ ] Distinguish explicit undo commands from inferred requests through application-owned provenance, not a model-supplied authorization field.
- [ ] Preserve one-message immediate eligibility only for existing deterministic commands; inferred undo always presents the pending latest expense in `EXPENSE_UNDO_CONFIRMING`.
- [ ] Require explicit confirmation, valid expiry, and latest-record identity before deletion. Preserve external-delete-before-local-success ordering and audit semantics.
- [ ] Make `request_save_retry` prompt for the explicit permitted retry command rather than perform the append; preserve the single-attempt limit and manual fallback. Scope reconfiguration to the existing recovery policy.
- [ ] Define no-mutation clarification behavior for ambiguous or mixed control intents, unsupported state/action pairs, and failures.
- [ ] Specify tests for immediate versus inferred undo, intervening messages, expired/replaced targets, failed deletion, cancellation with queued expenses, repeated retries, recovery limits, and injection requesting silent writes.
- [ ] Extend critical authorization evaluations and update cancellation, undo, recovery, FSM documentation, and indexes.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 7: Create the evaluation and gradual-rollout subplan

#### Description

Plan integrated acceptance evidence and staged activation across delivered capabilities, with measurable task-completion improvement and an exercised deterministic rollback path.

**Trigger:** `$create-plan Create the normal plan for Phase 7 of ai/plans/2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md, using the slug semantic_router_rollout. Revalidate Phases 1 through 6 and create the plan only.`

**Public contracts:** Versioned per-state acceptance report; release threshold configuration; cohort activation/rollback procedure and ownership; model/prompt/contract regression criteria.

**Closure evidence:** Recorded baseline and held-out results, zero critical-suite false authorizations, approved and met numeric budgets, controlled-rollout completion evidence, and a verified rollback procedure. Pending external rollout evidence remains visibly pending.

#### To-do actions

- [ ] Create and link the normal plan with separate implementation verification, real-provider evaluation, and external activation steps; plan approval alone does not deploy or activate the feature.
- [ ] Consolidate full conversation scenarios spanning recognition, clarification, correction, selection, explicit save, queued expenses, cancellation, delayed undo, retry, and timeout/restart behavior.
- [ ] Require meaningful unit, integration, worker, and end-to-end assertions, including no local expense or success confirmation on failed append and no deletion on invalid authorization.
- [ ] Record dataset split/version, provider/model, prompt/contract/policy versions, scenario counts, uncertainty, and per-state quality metrics. Re-evaluate when any of those decision components changes.
- [ ] Establish numeric action-accuracy, ambiguity, unnecessary-clarification, schema-failure, p95 latency, and cost-per-completed-expense budgets before candidate evaluation, with Product Owner and Tech Lead acceptance as required by ADR-023.
- [ ] Require zero false authorizations and unauthorized effects in the critical suite. Do not substitute average classification accuracy for this gate.
- [ ] Validate shadow coverage, then measure task completion in a controlled limited rollout; shadow agreement alone does not establish actual completion improvement.
- [ ] Define staged state/cohort activation, observation windows and sample requirements, accountable owners, rollback on false authorization or release-budget breach, and behavior for in-flight jobs and active reviews.
- [ ] Exercise rollback without a data migration and preserve deterministic explicit commands and original messages. Account for compatibility of any Phase 2 additive persistence changes.
- [ ] Complete canonical feature/configuration/FSM documentation and indexes, attach validation evidence, and update applicable user-story acceptance criteria only when implemented and verified.
- [ ] Update the master tracking table with child-plan links and implementation evidence; distinguish delivered capabilities from pending production activation.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Create the Phase 1 normal plan using its trigger after the user requests it.
