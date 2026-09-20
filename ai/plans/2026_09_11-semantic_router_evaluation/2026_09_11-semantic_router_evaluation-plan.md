# Plan: Semantic Router Evaluation

## Goal

Build a standalone, runnable evaluator for ADR-023's semantic decision contract through three approved vertical deliveries. Establish reproducible offline checks and explicitly initiated real-model comparisons, including pasted bank transaction notifications, without activating conversational routing.

## Context

- [Master plan, Phase 1](../2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md): Approved scope and separation of planning from implementation.
- [ADR-023](../../../docs/adr/ADR-023-constrained-llm-semantic-router.md): Closed decision vocabulary, minimal context, deterministic authority, and release gates.
- [AGENTS.md](../../../AGENTS.md), [plan conventions](../../../docs/plans/plan-conventions.md), and [testing guidelines](../../../docs/testing/guidelines.md): Required project conventions.
- [ADR-002](../../../docs/adr/ADR-002-llm-extraction.md) and [architecture decisions](../../../docs/adr/adr.md): Provider-independent application boundaries.
- [ClassifyFreeTextExpenseIntent](../../../src/application/use-cases/conversation/ClassifyFreeTextExpenseIntent.ts), [FreeTextIntent](../../../src/domain/value-objects/FreeTextIntent.ts), and [intent helpers](../../../src/application/utils/intents.ts): Reusable current lexical baseline.
- [RouteIncomingMessage](../../../src/application/use-cases/conversation/RouteIncomingMessage.ts) and [message worker](../../../src/interfaces/workers/message.worker.ts): Actual state-aware routing precedence; evaluate only bounded logic without starting workers.
- [ResolveExpenseReviewReplyUseCase](../../../src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase.ts) and [LLMPort](../../../src/domain/ports/services.ts): Current follow-up behavior already depends on model-based correction interpretation.
- [OpenAIAdapter](../../../src/infrastructure/adapters/llm/OpenAIAdapter.ts) and [adapter tests](../../../src/infrastructure/adapters/llm/OpenAIAdapter.spec.ts): Existing SDK and network-boundary test pattern. Existing JSON-object mode is not evidence of strict schema-constrained generation.
- [Dependency composition](../../../src/bootstrap/buildDependencies.ts): Existing provider preference must remain independent of evaluator composition.
- [Routing](../../../docs/features/incoming-message-routing.md), [clarification](../../../docs/features/clarification-request.md), [confirmation](../../../docs/features/expense-confirmation.md), and [FSM states](../../../docs/architecture/fsm-states.md): State and substep context for labeled examples.
- [Configuration](../../../docs/architecture/config-env.md), [package scripts](../../../package.json), [TypeScript configuration](../../../tsconfig.json), and [Vitest configuration](../../../vitest.config.ts): Place executable TypeScript under `src/` so ordinary lint/typechecking covers it.

### Approved delivery boundaries

- The user approved three deliveries: offline evaluator, first real adapter, and expanded dataset/comparison report. The user also required multiline bank transaction messages as explicit routing cases.
- Use OpenAI as the first evaluator adapter, with an explicitly selected compatible model and strict structured output. Verify the installed SDK and official provider contract during implementation before choosing the request shape or adding dependencies.
- Keep evaluator composition separate from application startup. Do not initialize databases, queues, messaging, spreadsheet clients, production state policies, or runtime router flags.
- The evaluator can accept/reject a proposal for assessment; it cannot authorize a save, retry, cancellation, or deletion. Production confirmation and state revision enforcement remain master Phase 2, integration remains Phase 3, and expense extraction integration remains Phase 4.
- No production accuracy claim may be derived from fixture responses. Mark unavailable baseline results and unmeasured metrics explicitly.
- Implemented documentation goes in `docs/features/semantic-router-evaluation.md` with `docs/features/README.md` updated at each delivery. These files are implementation deliverables, not documentation to create while writing this plan.

### Proposed file ownership

- Domain: `src/domain/ports/SemanticRouterPort.ts` and `src/domain/value-objects/conversation-decision.ts` for provider-neutral types.
- Application: `src/application/services/semantic-router/` for strict validation, bounded context, and pure state/substep policy; `src/application/use-cases/evaluation/` for assessment, baseline observation, and reporting.
- Infrastructure: `src/infrastructure/adapters/llm/OpenAISemanticRouterAdapter.ts` and its boundary tests.
- Interfaces: `src/interfaces/cli/evaluateSemanticRouter.ts` and CLI tests, with dedicated evaluator composition that does not import app bootstrap or dotenv loaders.
- Data: `evals/semantic-router/` for versioned development and held-out JSON fixtures, schema documentation, and optional explicitly sourced observation files. Runtime reports go to an explicitly selected output path and are not automatically committed.
- Keep pure policy shared with later router integration rather than copying state/action rules into a separate evaluator-only authority.

### Public contracts

#### Semantic proposal

Use ADR-023's exact discriminated vocabulary: `register_expense`, `cancel_current_flow`, `correct_expense`, `provide_missing_expense_data`, `undo_last_expense`, `select_option`, `request_save_retry`, `request_reconfiguration`, `request_clarification`, and `out_of_scope`. Only `select_option` carries `userReference`; only `request_clarification` carries an allowlisted reason. All other extra fields are rejected. There is no `confirm` action, generated identifier, rewritten source text, or free-form response.

```typescript
interface SemanticRouterInput {
  readonly rawMessage: string;
  readonly state: FsmState;
  readonly substep: string | null;
  readonly allowedActions: readonly ConversationDecision['action'][];
  readonly context: SemanticRouterContext;
}

interface SemanticRouterContext {
  readonly pendingQuestion: string | null;
  readonly missingFields: readonly string[];
  readonly expense: {
    readonly amount: number | null;
    readonly currency: string | null;
    readonly date: string | null;
    readonly concept: string | null;
  } | null;
  readonly options: readonly { readonly position: number; readonly label: string }[];
}

type SemanticRouterErrorCode =
  | 'INVALID_INPUT'
  | 'INPUT_TOO_LARGE'
  | 'UNSUPPORTED_CONFIGURATION'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'MODEL_REFUSAL'
  | 'INVALID_OUTPUT'
  | 'OUTPUT_TOO_LARGE';

interface SemanticRouterMetadata {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly contractVersion: string;
  readonly latencyMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

type SemanticRouterResult =
  | { readonly status: 'proposed'; readonly decision: ConversationDecision;
      readonly metadata: SemanticRouterMetadata }
  | { readonly status: 'failed'; readonly code: SemanticRouterErrorCode;
      readonly metadata: SemanticRouterMetadata };

interface SemanticRouterPort {
  decide(input: SemanticRouterInput): Promise<SemanticRouterResult>;
}
```

Reuse the repository's actual `FsmState` type. Runtime validation constrains state/substep combinations, missing-field names, currencies, finite amounts, dates, array lengths, and string lengths; typed strings do not imply unrestricted accepted values. Never pass generic `statePayload`, user/provider IDs, or credentials. Input action lists must be a subset of the canonical state/substep matrix; caller-supplied lists cannot broaden policy. States without semantic decisions are explicitly unsupported or deterministic-only.

`assessSemanticProposal(input, result): ProposalAssessment` returns `allowed`, `forbidden_action`, or `router_failure`, preserving the typed decision or error code as appropriate. This is classification policy, not execution authority. A syntactically valid forbidden action must remain distinguishable from malformed output for evaluation metrics.

#### Evaluator and baseline

- `EvaluationCase`: stable `id`, `datasetVersion`, `split: 'development' | 'held_out'`, scenario tags, validated `input`, `acceptedDecisions: ConversationDecision[]`, and `expectedHandling: 'semantic_proposal' | 'deterministic_only' | 'clarify'`. Fixtures may include `expectedFailure: SemanticRouterErrorCode | null` for protocol failures; fixtures with expected failures are reported separately from language-quality cases.
- `EvaluationCase` also carries `mustNotAuthorize: ('save' | 'delete' | 'retry')[]`. This labels critical scenarios; offline proposal assessment cannot certify downstream authorization behavior. Provider doubles must not read accepted labels to generate their outputs.
- `BaselineObservation`: `observed` with routing outcome, implementation/source version, and provenance; or `not_evaluated` with a reason. Provenance distinguishes current lexical execution, fixture replay, and explicitly sourced real-model observations.
- `EvaluateSemanticRouter.execute(input: EvaluationRunInput): Promise<EvaluationReport>` receives cases, an injected router, baseline observer, and run settings. No repository, messaging, queue, or spreadsheet port is available to this use case.
- `EvaluationReport`: report/dataset/contract/prompt/policy versions; mode; provider/model; case counts and denominators; per-state/substep action agreement, ambiguity precision/recall, unnecessary clarification, invalid-output and policy-rejection rates; failure counts; case-ID-only mismatches; observed coverage and missing baseline scopes; latency p50/p95; token totals and cost estimate provenance. Preserve nullable/unmeasured values instead of representing unavailable results as zero.
- Semantic decision equality checks relevant discriminant fields, not action names alone. For selectors, assessment checks allowed reference outputs without claiming provider identity resolution, which belongs to master Phase 5.
- Model execution timing is not acknowledgment latency. Cost for router calls is not cost per completed expense. Task completion, end-to-end false authorization, acknowledgment, and total expense cost remain explicitly unmeasured in this phase.

#### CLI

- `pnpm eval:semantic-router` runs a built-in offline development smoke dataset, using deterministic protocol fixtures without credentials or network access.
- Options: `--mode offline|live`, `--dataset <path>`, `--split development|held_out`, `--provider openai`, `--model <id>`, `--timeout-ms <integer>`, `--max-cases <integer>`, `--max-output-tokens <integer>`, and `--output <new-report-path>`. Reject unknown or incompatible arguments. Live mode requires explicit model and finite limits.
- Defaults: one concurrent live request, one request per case, 10-second timeout, and 256 output tokens, subject to verified model compatibility. Disable hidden SDK retries. Initial input ceilings: 8,000 message characters, 20,000 serialized input characters, 20 options, and 200 characters per option label. Reject over-limit input before network calls; do not silently truncate a message or option list.
- Live credentials come from the caller-provided process environment; never load `.env` or print values. Do not launch the application or auto-select a different provider when a configuration is unsupported.
- Emit reports using an explicit allowlist of fields. Operational logs use injected Pino with stable codes and no provider response bodies. Report mismatches by case ID, not financial text, selectors, or model reasoning.
- Exit codes: `0` for completed evaluation meeting its configured checks, `1` for completed evaluation with failed checks, `2` for invalid configuration/dataset or an incomplete run. Never mark a failed or partial live run as successful. Refuse to overwrite an existing output file by default.

### Mandatory bank-notification scenario

The user supplied this message as a required supported input shape:

```text
Fecha: 11 sept 2026, 21:09
Comercio: Mercadona
Importe: 16,55 €
Tarjeta: CREDITO SANTANDER
Nombre: Mercadona
Transacción: Mercadona
```

- In a configured user's `IDLE` or appropriate receiving substep, expect `register_expense`, despite the lack of an expense verb. No save is authorized.
- Preserve newlines, decimal comma, accented labels, and the non-breaking space before `€` in the canonical regression case. Add variants with ordinary/narrow non-breaking spaces, CRLF, reordered or missing labels, repeated merchant values, and casing differences.
- Repeated `Comercio`, `Nombre`, and `Transacción` values describe one notification, not three expenses. Multiple conflicting amounts or clearly distinct transactions require clarification rather than an invented single expense.
- In `EXPENSE_REVIEW`, an unqualified notification representing a different transaction proposes a new expense for later queue handling; it cannot confirm or overwrite the active review. A reply explicitly saying it corrects the current expense follows the correction path. Ambiguous references require clarification.
- In `EXPENSE_CLARIFYING`, distinguish an answer to the pending field from a clearly new complete transaction. Include cases with and without explicit correction/new-expense wording and label ambiguous cases conservatively.
- During onboarding selection or `EXPENSE_UNDO_CONFIRMING`, the notification must not be mistaken for an option or affirmative confirmation. Respect state allowlists and use controlled clarification where appropriate.
- Negative examples: `No registres esta notificación`, a question about its meaning, a declined payment, a refund, and text instructing the model to bypass confirmation. Do not treat every bank-shaped message as a completed expense; unsupported financial event semantics require clarification.
- The current lexical classifier already recognizes numbers and `€`. Record its actual result for this example; do not claim it is currently rejected or that semantic routing is an improvement on this specific input without evidence.
- Downstream acceptance destination, master Phase 4: extract amount `16.55`, currency `EUR`, date `2026-09-11`, and merchant/concept `Mercadona`, then present one expense for explicit review. Card text is payment context, never currency or authorization. Do not infer timezone from `21:09`, persist an unsupported card/bank field, or add a merchant/category mapping solely from this example. That extraction/review integration is not implemented by this evaluator plan.
- Use the supplied example as a development regression fixture. Held-out variants must be independently labeled and must not be copies differing only by whitespace; keep paraphrase/template families together to prevent split leakage.

## Phases

### Phase 1: Runnable offline evaluator and strict contracts

#### Description

Deliver the command, bounded decision contract, pure assessment, and a small representative dataset together so the first implementation can be executed and inspected without external services.

#### To-do actions

- [x] Add provider-neutral decision/input/result types and strict schemas, reusing current domain state types and following repository layer rules.
- [x] Define the explicit state/substep matrix and distinguish semantic-eligible examples from deterministic-only confirmations. Share pure policy with later integration without wiring it into production.
- [x] Implement `assessSemanticProposal` and the evaluator runner with injected router/baseline boundaries, report serialization, and strict CLI arguments under `src/`.
- [x] Add `eval:semantic-router` and an offline protocol-fixture adapter independent of expected labels. The command must complete without environment secrets, database, Redis, or network access.
- [x] Add development smoke cases for expense-like text, missing-data replies, corrections, mixed affirmation/correction, ambiguous selectors, forbidden actions, invalid output, and the exact bank notification above.
- [x] Observe baseline results using the real current pure classifiers and documented dispatch precedence for supported scopes. Mark model-dependent or unimplemented baseline scopes `not_evaluated`; do not duplicate phrase lists or substitute mocked correctness for measured accuracy.
- [x] Test `ConversationDecision` schemas for unknown actions, extra properties, invalid references/reasons, missing fields, and forbidden input action expansion.
- [x] Test `EvaluateSemanticRouter` for relevant-field equality, skipped baseline denominators, separate failure metrics, empty datasets, duplicate IDs, deterministic report content excluding timing, and no financial-text leakage.
- [x] Test CLI argument rejection, offline default, no secret/network requirement, stable exit codes, incomplete runs, and refusal to overwrite an existing report.
- [x] Execute the offline smoke command and inspect its report; require focused tests and `pnpm test` before closing the delivery.
- [x] Create `docs/features/semantic-router-evaluation.md` describing the offline tool, its command and limitations; update `docs/features/README.md`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

Phase 1 verification: `pnpm lint` and `pnpm typecheck` passed; `pnpm test` passed with 1,769 tests and 52 skipped tests; 27 focused tests passed again after the final policy adjustment. `pnpm eval:semantic-router` completed all 12 offline cases. No live provider calls were made. The user requested a handoff to continue Phases 2 and 3. Changes remain uncommitted; preserve existing staged files and graph artifacts.

### Phase 2: Real structured-output adapter and opt-in evaluation

#### Description

Deliver one real provider path through the same command, with strict validation, resource bounds, safe failure mapping, and deterministic network-boundary tests.

#### To-do actions

- [x] Verify installed SDK types and current official provider documentation for strict structured output, refusal/truncation handling, token limits, cancellation, and retry configuration. Record a compatible model/configuration without relying on the existing adapter's JSON-object mode.
- [x] Implement `OpenAISemanticRouterAdapter` behind `SemanticRouterPort`, explicitly selecting a structured decision and allowing no tool execution or multi-call repair loop.
- [x] Build a versioned prompt that treats raw messages and option labels as untrusted data. Serialize only the approved context projection and keep expected fixture labels out of provider input.
- [x] Enforce configured input/output limits, cancellation/timeout, finite case limits, one-call-per-case behavior, and no automatic SDK retries or provider substitution.
- [x] Map refusal, missing/truncated content, unsupported configuration, HTTP/network errors, schema failures, and oversize output to safe typed codes; do not expose response bodies or financial text in errors.
- [x] Wire dedicated live evaluator composition using explicitly supplied environment credentials and model settings without importing app bootstrap or dotenv.
- [x] Record actual model usage where supplied; leave absent usage as null. If cost estimates are enabled, accept an explicitly versioned rate input and label estimates, without embedding unverified current prices.
- [x] Test adapter request shape and all failure paths by mocking the SDK/transport boundary. Assert one request, cancellation propagation, no follow-up tool calls, input rejection before request, and protected error/report contents.
- [x] Test live CLI composition with a fake transport; no ordinary test may contact a provider. Document an optional user-initiated live smoke procedure using approved example data and finite limits.
- [x] Document adapter support and unavailable live evidence honestly. An unrun live experiment does not block completion of mocked implementation checks but remains pending evidence for subsequent evaluation and activation.
- [x] Require focused tests and `pnpm test`; update evaluator documentation and its feature index.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

Phase 2 verification (2026-09-12): 50 focused tests passed, with 44 adapter/CLI tests rechecked after final boundary adjustments. Full `pnpm test`: 1,802 passed, 52 skipped (outside sandbox because local HTTP listener tests require sockets). Lint and typecheck passed; the 12-case offline smoke passed. Installed SDK 4.104.0 and official structured-output documentation were verified. No live provider calls occurred; live quality/account evidence remains pending. Cost estimation is deliberately disabled. The user already authorized proceeding sequentially to Phase 3 and requested no automatic commit.

### Phase 3: Versioned dataset and comparison evidence

#### Description

Deliver a reviewable evaluation corpus and report that expose state-specific strengths, failures, and missing evidence. Keep proposal quality separate from end-to-end safety and product completion.

#### To-do actions

- [x] Expand the corpus to cover every semantic-eligible state/substep and rejected action combination in the current matrix; list unsupported and deterministic-only scopes explicitly.
- [x] Add regional Spanish, typos, negation, conditions, mixed intents, injection in messages/options, same message across different states, amount-bearing corrections, new expenses, ambiguous references, and protocol failures.
- [x] Include all bank-notification cases above, with the original message as development regression evidence and independently labeled held-out notification families.
- [x] Version the corpus, labels, splits, and normalization policy; validate unique IDs, compatible expected decisions, and no paraphrase/template-family overlap between development and held-out sets.
- [x] Review labels independently of candidate predictions. Freeze held-out labels before candidate evaluation and report any later correction as a new dataset version.
- [x] Produce current lexical baseline observations for supported scopes using actual code; preserve provenance for imported observations and keep model-dependent baseline coverage visibly missing until measured.
- [x] Report per-state counts, denominators, action agreement, ambiguity precision/recall, unnecessary clarification, schema/policy rejection, critical-case failures, latency and token usage with uncertainty where meaningful. Exclude offline fixture scores from claims of model accuracy.
- [x] Report task completion, acknowledgment latency, end-to-end unauthorized effects, and full expense cost as unmeasured, with destinations in master Phases 2, 4, and 7. No fixed accuracy target is invented from smoke fixtures.
- [x] Add report tests with hand-computable confusion matrices, zero denominators, missing usage/cost, skipped scopes, malformed case files, partial provider failures, and reproducible version metadata.
- [x] Execute the full offline evaluation and `pnpm test`. Perform real-model held-out comparisons only when explicitly initiated with data/model/resource settings; attach their evidence or leave them pending without claiming successful evaluation.
- [x] Complete evaluator documentation, dataset instructions, privacy rules, and downstream bank-notification acceptance links; synchronize the feature index.
- [x] Update the master Phase 1 implementation status only after the three deliveries and their required checks are complete. Record live-evaluation evidence separately and keep product activation pending.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

Phase 3 verification (2026-09-12): `pnpm lint`, `pnpm typecheck`, and full `pnpm test` passed (1,814 passed, 52 skipped). The combined focused evaluator/adapter/contract suite passed 72 tests; 53 relevant tests passed again after final report/type adjustments, and the final full suite includes the additional boundary assertions. Both complete offline corpus runs passed: development 175/175 (60 language, 111 protocol, four deterministic-only), held-out 25/25 language cases. The original 12-case smoke remains unchanged and passes.

Delivered artifacts: [versioned corpus](../../../evals/semantic-router/corpus.json), [independent response fixtures](../../../evals/semantic-router/corpus-responses.json), [freeze manifest](../../../evals/semantic-router/manifest.json), [dataset instructions](../../../evals/semantic-router/README.md), and [canonical feature/observations](../../../docs/features/semantic-router-evaluation.md). Local review reports were written to `/tmp/semantic-final-development-20260912.json` and `/tmp/semantic-final-held-out-20260912.json`; they are not automatically committed.

Labels were authored and reviewed without candidate predictions and frozen before expanded response fixtures. Independent human adjudication remains pending. No real-provider calls, imported baseline observations, chatbot integration or commits occurred. Costs are not estimated. Live model-quality/account evidence, end-to-end authorization safety, task completion, acknowledgment latency, full expense cost and activation budgets remain pending at their documented master-plan destinations. Offline fixture agreement is not model accuracy. The master Phase 1 implementation entry now records all three deliveries separately from pending live evidence and activation. The user authorized both phases sequentially; no further implementation phase is started.

## Next step

On a separate user request, revalidate the delivered contracts and create the master Phase 2 confirmation-safety subplan; independently budget any real-provider evaluation, retaining pending human label review and production activation gates.
