# Feature: Semantic Router Evaluation

## Purpose

Evaluate ADR-023's constrained proposals through reproducible offline checks and explicitly budgeted OpenAI calls, without enabling chatbot routing or business effects.

## Behavior (Implemented)

- `pnpm eval:semantic-router` runs 12 development smoke cases without credentials, dotenv, network, database, queues, messaging, or spreadsheet operations.
- The provider-neutral `SemanticRouterPort` accepts a bounded message, FSM state/substep, caller-narrowed action list, and a strict context projection. Domain types have no validation-library dependency.
- Strict Zod schemas reject unknown fields/actions, invalid dates/currencies, oversized inputs, duplicate positions and caller attempts to widen the policy. Source text is preserved, including the Mercadona notification's newlines and non-breaking space.
- The policy enumerates every current FSM state. Normal input steps support expense proposals, missing-data replies, review corrections, file/sheet selections, and request-only recovery. Unknown substeps and processing-only/unsupported states reject semantic input. Sheet `idk` permits selection; `empty-sheet-confirm` permits guidance only. Other onboarding configuration states remain unsupported.
- A valid proposal outside the input allowlist produces `forbidden_action`, distinct from `router_failure/INVALID_OUTPUT`. No proposal constitutes authority to execute an operation.
- The offline adapter reads a separate response map keyed by message/state/substep hash and never accesses expected labels. Its results measure protocol fixture agreement, not model accuracy.
- Cases identify language, protocol rejection/failure, or deterministic-only handling. Reports compare relevant decision fields, including clarification reasons and selector strings. Zero denominators are null.
- Baseline observation runs current pure classifiers. For `IDLE`/`EXPENSE_RECEIVING` it reports actual ingress admission or guidance, including command bypass. For normal review text it observes explicit confirmation/cancellation; remaining model-dependent replies and unsupported scopes are not evaluated. It does not claim complete worker simulation or baseline semantic accuracy.
- A source hash identifies the current lexical helper/dispatch files used for baseline interpretation. Reports include dataset, contract, policy and fixture-router versions, per-scope checks, baseline coverage and mismatch IDs.
- Raw messages, selectors, model reasoning and provider response bodies are excluded from reports. The CLI uses the injected Pino logger for bounded operational errors.
- The Mercadona case expects a registration proposal and observes that the current lexical filter already admits the message. Actual extraction of amount/date/merchant and user review remain a later integration requirement.

## API / Interface

- `SemanticRouterPort.decide(input): Promise<SemanticRouterResult>` returns a typed proposal or safe error with provider-independent metadata.
- `assessSemanticProposal(input, result)` returns `allowed`, `forbidden_action`, or `router_failure`; it performs no business effects.
- `EvaluateSemanticRouter.execute(input)` accepts a validated dataset and injected router/baseline observer and returns a report. Offline and explicit live execution share this use case.
- CLI options: `--mode offline`, `--dataset <json>`, `--responses <json>`, `--split development|held_out`, `--max-cases <1..1000>`, `--output <new.json>`. Custom offline datasets require a response file; live mode forbids one. Unknown or incompatible options and empty selections fail.
- Exit `0`: all selected decision checks passed in a complete run; this is not an activation gate. Exit `1`: completed checks contain mismatches. Exit `2`: invalid configuration/data, incomplete run, or output failure. Existing report files are never overwritten.

## Measurement limits

No real-provider evidence has been collected. Offline model accuracy, latency, usage and cost remain null. Live runs can measure decision agreement, router-call latency and usage, while acknowledgment latency, actual false authorization and task completion remain unmeasured. Fixture timings and expected-output replay are not production evidence. Per-scope agreement includes declared protocol checks; language and protocol totals are reported separately.

The input ceiling is 8,000 message characters, 20,000 serialized input characters, 20 options and 200 characters per option label. Dataset/response files are bounded at 2 MB and datasets at 1,000 cases. These limits reject input rather than silently rewriting it.

## Tests

- `contracts.spec.ts`: decision/schema rejection, context bounds, date/currency validation, action expansion, unsupported states/substeps, and forbidden versus malformed output.
- `EvaluateSemanticRouter.spec.ts`: smoke outcomes, bank admission baseline, no financial-text reporting, deterministic reports, field-aware equality, independent labels/responses, invalid datasets, null denominators and incomplete runs.
- `evaluateSemanticRouter.spec.ts`: offline/no-network execution, argument validation, safe exit codes, missing split, report persistence and overwrite protection.

## Behavior (TODO)

- Live quality evidence remains pending explicit execution; Phase 2 implementation is available below.
- Independent human label adjudication and explicitly initiated live held-out comparisons remain pending; the expanded corpus is implemented below.
- Confirmation revision safety, live shadow integration, actual bank-message extraction/review, and rollout: [master Phases 2 through 7](../../ai/plans/2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md).

## Related Decisions

- [ADR-023](../adr/ADR-023-constrained-llm-semantic-router.md).
- [Fixture instructions](../../evals/semantic-router/README.md).

## Phase 2: explicit live evaluation

The evaluator now supports `--mode live --provider openai` with all of `--model`,
`--max-cases` (1..1000), `--timeout-ms` (1..60000) and `--max-output-tokens`
(64..4096) explicitly supplied. Offline remains the default. Live excludes protocol
injections and deterministic-only checks; each selected language case makes at most
one request, sequentially, with no SDK retries or repair calls. Failures make the
live report incomplete (exit 2); label mismatches without failures return 1.

Supported configurations are Chat Completions with snapshots
`gpt-4o-mini-2024-07-18`, `gpt-4o-2024-08-06`, and `gpt-4o-2024-11-20`.
No alias, endpoint override, provider substitution or implicit model is selected.
The CLI takes `OPENAI_API_KEY` from the caller's environment without dotenv or app
bootstrap. No credentials are needed for offline mode or automated tests.

The installed SDK is **openai 4.104.0** (verified 2026-09-12). Its
`resources/shared.d.ts` exposes `ResponseFormatJSONSchema.strict`,
`resources/chat/completions/completions.d.ts` exposes `max_completion_tokens`,
refusal and finish reasons; `core.d.ts` and the installed README document request
`signal`, timeout and `maxRetries: 0`. No dependency upgrade was needed.

The adapter sends a strict JSON Schema object containing `decision`, with a nested
`anyOf` for the closed union. Every branch prohibits extra fields; local Zod
validation additionally enforces reference bounds. This follows the official
[Structured Outputs contract](https://developers.openai.com/api/docs/guides/structured-outputs),
including the root-object restriction, refusal field and truncated-output handling.
[GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini) and
[GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o) document structured
output support and the listed snapshots. Account availability is unverified.

`semantic-openai-v1` treats messages, questions, concepts and option labels as
untrusted data. It receives only validated router input, never expected labels.
No tools, business ports or generated source-text replacements are available.
A separate deadline aborts the request, even if the transport remains pending.
Output is limited to 4,000 characters as well as the selected token ceiling.
Refusal/filtering maps to `MODEL_REFUSAL`, truncation to `OUTPUT_TOO_LARGE`,
malformed/missing/tool output to `INVALID_OUTPUT`, HTTP 400/404/422 to
`UNSUPPORTED_CONFIGURATION`, timeout to `TIMEOUT`, and other transport errors to
`PROVIDER_ERROR`. Only safe codes leave the boundary.

Live reports identify their mode, settings and provider/prompt versions, record
provider usage when available, and leave incomplete usage totals null. Latency is
router-call timing including failures, not acknowledgment latency. Cost estimation
is not enabled: no unverified prices are embedded. No live evaluation has been run;
SDK/schema tests are implementation evidence, not measured model quality.

Optional user-initiated smoke procedure, after approving the dataset and arranging
the API key in the process environment (do not put its value in shell history):

```bash
pnpm eval:semantic-router --mode live --provider openai \
  --model gpt-4o-mini-2024-07-18 --max-cases 1 \
  --timeout-ms 10000 --max-output-tokens 256 \
  --output /tmp/semantic-live-smoke.json
```

This budget permits at most one call and 256 generated tokens; input and prompt
also incur usage. The output path must be new. Automated adapter and CLI tests use
fake SDK/HTTP boundaries, including deadline, refusal, truncation and retry checks.


## Versioned corpus and comparative reporting

The default remains the original 12-case smoke regression. `corpus.json` adds a
separate 200-case corpus: 175 development cases (60 language, 111 protocol, four
deterministic-only) and 25 held-out language cases. Every one of the ten eligible
state/substep scopes has language coverage in both splits. A 100-case development
protocol matrix injects every action into every eligible scope, testing both
allowed and forbidden proposals; these rows never count as language quality.

Corpus `semantic-corpus-v2`, labels `semantic-labels-v2`, and `family-split-v1`
are pinned by `evals/semantic-router/manifest.json`. Labels were authored and
reviewed from the specification and scenario meaning before response fixtures,
without candidate predictions. Human independent review is **pending**. This is a
synthetic engineering corpus, not a representative or externally adjudicated
Spanish-language benchmark. Held-out examples have not been used to tune a model
or prompt; replaying protocol fixtures is not a model evaluation.

Validation rejects duplicate IDs, inconsistent versions, incompatible allowed or
forbidden expectations, missing family IDs in a provenance-bearing corpus, and
family/normalized-message overlap across splits. Split-check normalization is
NFKC, Spanish lowercase, whitespace collapsing and trimming. It does not modify
router messages or implement selector resolution. Selector decision comparison
uses the schema-trimmed reference exactly; no hidden synonym matching is applied.
The checks cannot detect undeclared semantic paraphrase relationships: family
assignment still requires review. Any later label correction requires a new
corpus/label version, a refreshed manifest and a recorded rationale.

`semantic-evaluation-v2` reports versions, whole parsed-artifact SHA-256 digests,
selected split and exclusions, per-scope counts, decision agreement, clarification
confusion/precision/recall, unnecessary clarification, schema/policy rejection,
critical-case check failures, safe failure counts and mismatch IDs. Live agreement
has a descriptive Wilson 95% interval; it does not establish population confidence
because these examples are small, synthetic and related. Timing is nearest-rank
p50/p95 over available router-call metadata, including typed failures; sample counts
and missing token totals remain visible. Complete totals and observed partial
usage are separate. Cost estimates are disabled, and no current prices are assumed.

Lexical comparisons are restricted to a common measurable projection: ingress
admission versus guidance for unambiguous eligible actions, and explicit review
cancellation where observed. Candidate admission agreement is **not** semantic
accuracy: enqueueing says nothing about which action eventually executes. Other
baseline scopes remain `not_evaluated`, with `model_dependent` or
`unsupported_scope` reasons. The evaluator does not import external baseline
observations; current observations are executed from local code and identified by
the source digest. Do not substitute an imported/mock result under that provenance.

### Reproduced offline observations (2026-09-12)

| Evidence | Development | Held-out |
| --- | ---: | ---: |
| Completed offline case checks | 175/175 | 25/25 |
| Language fixture agreement (not model accuracy) | 60/60 | 25/25 |
| Protocol checks | 111/111 | 0/0 (unmeasured) |
| Current lexical observations, all case kinds | 58 | 10 |
| Baseline not evaluated, all case kinds | 117 | 15 |
| Lexical ingress agreement on comparable language cases | 14/19 | 5/8 |
| Fixture ingress projection agreement on that cohort | 19/19 | 8/8 |

These paired counts compare fixture projections with actual lexical execution.
They do not demonstrate model improvement. The exact bank notification already
produces lexical `enqueued`; no claim of fixing its existing admission is made.
Baseline source digest:
`7caa47009451724d5a1f22aa7e24f1dd533aa0e1481747a3feca42b040fc3d35`.
Reproduce the observations with the commands in the
[dataset instructions](../../evals/semantic-router/README.md). Runtime reports are
written only to an explicitly selected new path, never automatically committed.

### Remaining integration evidence

The unsupported states are `EXPENSE_CORRECTING`, `EXPENSE_SAVING`,
`ONBOARDING_START`, `ONBOARDING_DRIVE`, `ONBOARDING_VALIDATING_ACCESS`,
`ONBOARDING_MAPPING`, and `ONBOARDING_CATEGORIES`. All unknown substeps reject
semantic input. Explicit save/delete/retry authorization stays deterministic.
`EXPENSE_UNDO_CONFIRMING` and sheet `empty-sheet-confirm` permit guidance only;
the evaluator's confirmation examples merely test the absence of semantic authority.

The bank family covers spacing, CRLF, casing, reordered/missing labels, duplicate
merchant values, conflicting amounts, distinct transactions, state changes,
corrections, missing-field answers, ambiguous references, negation, questions,
declines, refunds and injected instructions. Held-out wallet notifications and
receipt/settlement compositions use separate families. Original text remains intact.
Downstream extraction of **one** Mercadona expense (`16.55 EUR`, `2026-09-11`),
explicit review, queue handling and no inferred timezone/card fields belong to
[master Phase 4](../../ai/plans/2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md#phase-4-create-the-expense-flow-integration-subplan).

Actual unauthorized effects require master Phases 2 and 7; acknowledgment latency
requires Phases 3 and 7; task completion and full expense cost require Phases 4
and 7. Numeric activation thresholds, real held-out comparisons, shadow/rollout
results and human label review remain pending. Offline green checks authorize none
of these integrations or product activation.

Additional tests: `comparison.spec.ts` verifies hand-computable confusion and
paired denominators, partial provider failures, missing usage and uncertainty;
`corpus.spec.ts` verifies matrix/split contracts and the exact bank input;
`semanticCorpusManifest.spec.ts` pins provenance artifacts. CLI tests run both
splits, verify exclusion-before-budget, and prevent calls when output already exists.
