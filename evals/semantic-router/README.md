# Semantic router evaluation data

Run `pnpm eval:semantic-router` for the original 12-case offline development smoke
check. No credentials, environment files, network, database or app startup are
required. This smoke set and its separate `offline-responses.json` stay intact.

## Expanded corpus

`corpus.json` contains 220 cases under `semantic-corpus-v3`:

| Split       | Language | Protocol | Deterministic only | Total |
| ----------- | -------: | -------: | -----------------: | ----: |
| development |       70 |      113 |                  4 |   187 |
| held_out    |       33 |        0 |                  0 |    33 |

Every eligible scope has language examples in each split. The ten scopes are
IDLE, EXPENSE_RECEIVING, EXPENSE_CLARIFYING, EXPENSE_REVIEW,
EXPENSE_SAVING_RETRY, EXPENSE_UNDO_CONFIRMING, ONBOARDING_FILE and
ONBOARDING_SHEET at the normal step, plus ONBOARDING_SHEET `idk` and
`empty-sheet-confirm`. Normal steps are represented by `substep: null`.

The development protocol grid covers all ten actions in each of these ten scopes.
Other protocol cases exercise all safe error codes and malformed output. Tags
include `protocol` for boundary-only stimuli, which never enter live language
scoring. Explicit confirmations are `deterministic_only`, not semantic authority.
Unsupported states and unknown substeps remain denied by the input schema and
are listed by the report, not falsely recorded as model-tested.

## Label and split provenance

Labels were authored from ADR-023 and scenario meaning and reviewed without candidate
predictions. The v2 labels were frozen on 2026-09-12; the appended stateful v3 labels
were frozen on 2026-09-16, in both cases **before** writing their response fixtures.
No live candidate was evaluated or used for prompt tuning. Independent human label
adjudication remains pending. These synthetic labels should not be presented as a
representative, externally reviewed benchmark.

- Label version: `semantic-labels-v3`.
- Split version: `family-split-v2`.
- Leakage-check normalization: `nfkc-case-whitespace-v1` (NFKC, Spanish lowercase,
  collapse whitespace, trim). Messages sent to the router retain their original text.
- `manifest.json` pins the byte hashes of corpus and response files. Reports
  separately hash the whole parsed dataset/response artifacts in JSON property
  order, before filtering or limiting cases; these differ from pretty-file hashes.
- IDs are globally unique within the corpus. All paraphrases/template variants in
  a family stay in one split. Normalized identical messages cannot cross splits,
  even across states. Automated checks cannot discover misdeclared paraphrase
  families, so human family review remains necessary.
- A post-freeze label correction requires a new corpus and label version, a manifest
  update and a rationale recorded here. Never relabel to hide a candidate failure.
  Version 3 appends stateful expense-flow families and does not relabel v2 cases.

The Mercadona notification is the exact supplied regression: newlines, decimal
comma, accents and non-breaking space are preserved. Its development family covers
format variants and state-dependent handling; held-out wallet push, receipt mail
and settlement families differ in structure/intent rather than just whitespace.
Synthetic Spanish cases also cover regional forms, typos, negation, conditions,
mixed intents, message/option injection, amounts, new expenses and ambiguous options.

## Case contract and response independence

Each case declares `id`, `family` (required with corpus provenance),
`datasetVersion`, `split`, `tags`, bounded `input`, `acceptedDecisions`,
`expectedHandling`, `expectedAssessment`, `expectedFailure` and `mustNotAuthorize`.
Accepted decisions must match the declared allowed/forbidden assessment. Failure
cases accept no decision. The `clarify` handling requires clarification labels.
Legacy smoke data without provenance/family metadata remains supported and is
reported with null provenance.

`corpus-responses.json` is a separately authored protocol-response map, not model
predictions. It is keyed by SHA-256 of `JSON.stringify([state, substep, rawMessage])`.
The offline adapter only receives that map and router input. Expected decisions,
case IDs, split/family metadata and label provenance never reach either adapter.
Changing a label does not change its fixture response. Protocol-grid responses
are deliberate action/error injections; their agreement tests policy, not language.
`mustNotAuthorize` labels critical cases but cannot certify downstream effects.

## Reproduce both offline splits

```bash
pnpm eval:semantic-router --dataset evals/semantic-router/corpus.json \
  --responses evals/semantic-router/corpus-responses.json --split development \
  --output /tmp/semantic-development.json

pnpm eval:semantic-router --dataset evals/semantic-router/corpus.json \
  --responses evals/semantic-router/corpus-responses.json --split held_out \
  --output /tmp/semantic-held-out.json
```

Output files must be new. Custom offline datasets require independent response
files; unknown/incompatible options, malformed files and empty selections fail.
With restricted local socket access, `node --import tsx
src/interfaces/cli/evaluateSemanticRouter.ts` runs the same CLI without the tsx
launcher's IPC socket. Add the same arguments on that command line.

The expense-flow rerun on 2026-09-16 completed 187/187 and 33/33 checks, with
zero fixture mismatches and zero critical-case failures. Actual lexical ingress agreement on the comparable
language subset was 14/19 development and 5/8 held-out. Corresponding fixture
projection agreement was 19/19 and 8/8. **This is not evidence of model accuracy or
improvement.** The exact Mercadona input already produces lexical `enqueued`.
The current deterministic-source digest is
`7e9df3bee9c64b8b1d6b7f10c50b159a17e9e6eb9a0de975e44651b2c98080be`;
the expanded stateful labels were frozen before their fixtures were authored.
See the [feature document](../../docs/features/semantic-router-evaluation.md)
for source digest, baseline scope omissions and metric definitions.

## Optional live procedure and privacy

No live evaluation has occurred. A user must explicitly initiate it with approved
data, a supported snapshot, case budget, timeout and output-token budget. Configure
`OPENAI_API_KEY` in the caller environment without exposing it in command history;
never read `.env`, credential files or real private conversations into fixtures.

Example only, **not executed**: capped held-out candidate sample, at most 25
sequential requests, 256 generated tokens/request, 10 seconds/request:

```bash
pnpm eval:semantic-router --mode live --provider openai \
  --model gpt-4o-mini-2024-07-18 \
  --dataset evals/semantic-router/corpus.json --split held_out \
  --max-cases 25 --timeout-ms 10000 --max-output-tokens 256 \
  --output /tmp/semantic-held-out-live.json
```

The maximum generated-token allocation is 6,400; input/prompt usage costs extra.
No hidden retries, fallback provider or repair calls are enabled. Use a new output
path for each run; compare identical dataset digests, selected IDs, settings and
prompt/contract/policy versions. Live excludes protocol and deterministic-only
cases before applying the budget and reports the omissions. Real-provider
failures make the run incomplete (exit 2), including typed refusals or invalid
output; ordinary decision mismatches produce exit 1. Exit 0 only means selected
checks passed, not task completion or permission to activate a product feature.

Reports/logs omit messages, labels, selector contents, credentials, response bodies
and reasoning. Only safe IDs/actions/status codes and aggregates are serialized.
Keep identifiers nonsensitive. Preserve actual provider usage and null unavailable
metrics. External baseline observation imports are not supported; never label
fixture/imported outputs as current lexical execution.

Any candidate report should retain its source/version/settings evidence and report
all failures. Release thresholds require separate approval against measured
baseline data before activation; no target is inferred from green smoke fixtures.
Conversation-level integration now measures unauthorized effects and bounded local
acknowledgment timing, but not production percentiles, live task completion, or full
expense cost. Before any Phase 4 capability is activated, Phase 7 must obtain approved
numeric per-state quality/latency/cost budgets, run an explicit live held-out evaluation,
retain zero critical false authorizations, and approve a limited cohort with rollback
ownership. Implementation and fixture success alone do not activate a state.
