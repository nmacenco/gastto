# ADR-023: Introduce a Constrained LLM Semantic Router for Conversational Decisions

**Date**: 2026-09-10
**Status**: Accepted
**Accepted on**: 2026-09-11
**Deciders**: Product Owner, Tech Lead, Architecture Reviewer

## Context

Gastto already uses an LLM to extract structured expense data and interpret expense
corrections. However, the surrounding conversational flow still relies on lexical
heuristics and exact or near-exact phrase matching to classify messages such as
confirmations, cancellations, undo requests, expense-like text, and onboarding replies.

This creates a gap between the language understanding users expect from an LLM-powered
product and the behavior they experience. Semantically clear phrases can be rejected or
routed incorrectly when they do not contain the expected keywords. Adding more phrases
to static lists improves isolated cases but does not solve the underlying limitation.

The persisted FSM remains necessary. It protects valid transitions, keeps multi-turn
operations durable, supports timeouts and recovery, and prevents a language model from
bypassing business invariants. Write confirmation, per-user serialization, idempotency,
and downstream authorization must also remain deterministic.

The architectural question is therefore not whether the FSM should be removed, but where
semantic interpretation should sit and how much authority an LLM should receive.

The desired product behavior is:

- Understand natural phrasing, paraphrases, regional variants, and minor errors.
- Interpret messages in the context of the active conversational state.
- Preserve explicit user confirmation for consequential actions.
- Never allow model output alone to mutate state or external data.
- Degrade safely when the model is unavailable, ambiguous, or returns invalid output.
- Retain provider independence through application/domain ports.

This ADR records the accepted architectural direction. Acceptance does not mean the
router is implemented or enabled; activation requires the evaluation gates below.

## Considered Options

1. **Keep deterministic lexical routing and expand phrase lists**
   - Pros: Predictable, inexpensive, low latency, and easy to test exhaustively for known phrases.
   - Cons: Continues to reject valid natural language, grows through special cases, and cannot reliably interpret context-dependent phrasing.

2. **Invoke an LLM only when deterministic routing reports that it did not understand**
   - Pros: Limits LLM calls and can be introduced without replacing existing routing immediately.
   - Cons: The existing router can misclassify a message without recognizing that it failed, so many false decisions never reach the fallback. It also creates two sources of conversational policy that can diverge over time.

3. **Make an LLM the primary agent and expose the current chatbot or its operations as MCP tools**
   - Pros: Maximizes conversational flexibility and allows the model to select capabilities dynamically. MCP can provide standardized tool discovery and typed inputs and outputs.
   - Cons: Gives the model orchestration authority over a workflow with financial writes and destructive undo operations. Wrapping the current chatbot as one coarse tool does not remove its internal rigidity, while exposing many low-level tools increases excessive-agency and prompt-injection risk. MCP adds an internal protocol boundary without a current interoperability requirement.

4. **Use an LLM as a constrained semantic router and keep deterministic execution**
   - Pros: Improves language understanding while preserving the FSM, confirmation rules, validation, authorization, and existing use cases as the source of truth. Model output can be schema-validated, allowlisted per state, observed, and evaluated independently.
   - Cons: Adds latency and provider dependency to more conversational turns. Requires a carefully designed decision contract, state-aware evaluation datasets, and explicit fallback behavior.

## Decision

Adopt **Option 4: use an LLM as a constrained semantic router and keep deterministic
execution**.

The LLM will interpret free-text messages at conversational decision points and return a
typed proposal. It will not choose raw FSM target states, invoke repositories, write to a
spreadsheet, delete rows, or execute business use cases directly.

A deterministic policy layer will receive the proposal and decide whether it is permitted
for the current FSM state. Only then will existing application use cases execute the
action and perform any state transition.

MCP is not required for the internal implementation. The semantic router will depend on a
provider-neutral port and typed contracts inside the modular monolith. A future ADR may
expose selected Gastto capabilities through MCP if external assistants or applications
need interoperable access.

### Execution placement and initial scope

Run semantic interpretation in the `process-message` worker after identity validation,
acquiring the per-user processing lock, and loading the current persisted FSM state.
Do not call the model in the single-concurrency `incoming-message` worker. Preserve
prompt acknowledgment and cross-user processing concurrency under ADR-011.

For enabled states, the ingestion layer must enqueue free text without discarding it
through the existing lexical financial-intent filter. The processing worker evaluates
the activation policy against the current state under the lock; ingestion must not make
an authoritative routing decision from an earlier state snapshot. When disabled, use
the deterministic routing behavior. Shadow evaluation must also sample messages the
existing filter would reject, without executing the model's proposed action.

The FSM owns the state-to-action policy. After the model returns, validate that the
state, pending operation, expiry, and relevant revision still match the input snapshot
before execution. A changed or expired context invalidates the proposal. All other
state writers must participate in compatible locking or conditional-update checks.

The first release covers expense recognition, corrections, missing-data replies, and
reversible option selections. Save, undo, and save-retry authorization remain explicit
through deterministic commands or typed callbacks. Enable additional actions or states
only after their evaluation gates pass. Product-question answering and free-form
informational generation are deferred to a separate design backed by canonical product
content; they are outside this router's initial contract.

## Decision Contract

The exact contract will be finalized during implementation design, but it must follow a
closed, discriminated structure equivalent to:

```typescript
type ConversationDecision =
  | { action: 'register_expense' }
  | { action: 'cancel_current_flow' }
  | { action: 'correct_expense' }
  | { action: 'provide_missing_expense_data' }
  | { action: 'undo_last_expense' }
  | { action: 'select_option'; userReference: string }
  | { action: 'request_save_retry' }
  | { action: 'request_reconfiguration' }
  | {
      action: 'request_clarification';
      reason: 'ambiguous_intent' | 'mixed_intents' | 'ambiguous_reference' | 'explicit_confirmation_required';
    }
  | { action: 'out_of_scope' };
```

This is a vocabulary of proposals, not a list enabled in every state or in the first
release. Maintain an explicit state/substep-to-action matrix including clarification,
onboarding, and recovery states. Recovery proposals do not authorize a retry or relax
the retry limit established by ADR-018. A semantic undo request offers confirmation;
it never authorizes deletion. There is no semantic confirmation action in the initial
contract.

Expense extraction, correction, and missing-data use cases receive the original user
message retained by the application, never a model-generated rewrite. The application
maps clarification reasons to bounded, application-owned copy. An invalid output uses
the same controlled fallback mechanism.

The model input may contain only the context necessary to interpret the current turn:

- The raw user message, marked as untrusted data.
- The current FSM state.
- The actions allowed to be proposed in that state.
- A bounded, sanitized summary of relevant state payload data.
- Display labels required to resolve a user reference, without credentials or provider tokens.

Build a dedicated context projection with an explicit field allowlist per state/substep;
never serialize the complete state payload. Supply only the pending question, needed
expense fields, missing-field names, and currently displayed option labels and positions.
Treat labels and other externally supplied content as untrusted data too. Internal
operation identifiers and revisions remain application-owned validation context.

The output must use structured generation or tool/function calling with strict schema
validation. Unknown actions, additional properties, malformed output, invented identifiers,
and disallowed actions must be rejected before any side effect.

## Authority Boundaries

### The LLM may

- Classify semantic intent in the context of the active state.
- Extract a user-facing reference such as "the second file" or "the expenses sheet".
- Propose a correction or a new expense interpretation.
- Identify ambiguity and return a structured clarification reason.

### The LLM must not

- Return or select arbitrary FSM target states.
- Bypass the valid-transition map.
- Call repositories or spreadsheet adapters directly.
- Generate trusted database, spreadsheet, user, file, sheet, or row identifiers.
- Decide whether the authenticated user is authorized.
- Confirm that a write, deletion, or transition succeeded.
- Disable confirmation, idempotency, locking, timeout, retry, or recovery rules.

The deterministic system must resolve natural references against real options and reject
zero or multiple matches. It must enforce authorization in downstream use cases and derive
user-facing success messages from actual operation results.

Resolve a reference only against the exact, ordered option snapshot shown for the active
step. Ordinals refer to that snapshot; label matching uses documented normalization and
must produce exactly one match. Duplicate names, stale lists, out-of-range positions,
and ambiguous references require clarification. Model-provided references are untrusted
selectors, never provider identifiers or authorization evidence.

## Confirmation Policy

The semantic router proposes intent; it does not constitute user authorization by itself.

- Creating an expense continues through `EXPENSE_REVIEW` before saving.
- State allowlisting alone is not evidence of user authorization. Initial save, delayed
  undo, and save-retry confirmation must come from a typed callback or a whole-message,
  unambiguous, allowlisted command processed deterministically.
- Bind confirmation to the pending operation and the revision of the summary shown to
  the user. Corrections invalidate previous confirmation context and require a new
  review. Reject stale callbacks and expired or superseded operations.
- Negation, conditions, corrections, and mixed intents must not confirm an operation.
  For example, `sí, pero cambia el importe a 25` is a correction requiring a new review,
  never authorization to save the previous amount. Unresolved mixed intents require
  clarification without a write.
- Delayed undo continues to require explicit confirmation.
- Preserve ADR-017's immediate-undo exception only for the existing explicit,
  deterministically recognized undo command with valid one-message eligibility.
  Semantically inferred undo requests always enter `EXPENSE_UNDO_CONFIRMING`, even
  when immediate eligibility exists. Confirmation remains bound to the offered expense,
  which must still be the latest non-deleted record at execution.
- All other destructive or difficult-to-reverse operations require explicit confirmation
  regardless of model confidence. Expanding semantic confirmation requires a follow-up
  decision and separate evaluation of false authorizations.
- Reversible selections may execute without an additional confirmation only after deterministic resolution to exactly one currently available option.
- Ambiguous language results in clarification and no state mutation.

Inline callbacks and other already-typed channel actions may bypass semantic interpretation
and continue through their deterministic handlers.

## Failure and Fallback Behavior

An LLM timeout, provider error, invalid schema, unknown proposal, or proposal forbidden in
the current state must never result in a write or destructive action.

The policy layer will choose one of two safe outcomes:

1. Use an existing deterministic handler only when the input is an exact, unambiguous,
   allowlisted command for the current state.
2. Keep the current state and ask the user a bounded clarification question using an
   application-owned copy.

The system must cap model/tool iterations. The router is a single structured decision call,
not an open-ended autonomous agent loop.

## Observability and Evaluation Requirements

Before activation, the feature must define an evaluation dataset containing realistic
Spanish variants, regional expressions, typos, negation, mixed intents, prompt-injection
attempts, and every state/action combination.

Evaluation must measure at least:

- Correct action proposal by current FSM state.
- False authorization of confirmation or destructive actions.
- Ambiguity detection quality.
- Invalid or out-of-schema output rate.
- Deterministic-policy rejection rate.
- End-to-end task completion compared with the current router.
- Unnecessary clarification rate by state.
- Added latency, including p95, by state and provider, and acknowledgment latency.
- Total model cost per completed expense, including extraction and correction calls.

Runtime logs and traces must record the model/provider version, prompt/contract version,
current state, proposed action, policy outcome, latency, and stable error code. They must not
record raw financial messages, credentials, full state payloads, or hidden model reasoning.

### Activation gates

Architectural acceptance is separate from permission to enable a state in production.
Before enabling each state/action cohort:

1. Run a versioned, independently labeled evaluation set covering allowed and forbidden
   actions, realistic Spanish, conditions, negation, mixed intents, stale confirmations,
   reference ambiguity, provider failures, and prompt injection. Use a held-out set and
   report sample counts and uncertainty alongside rates.
2. Require zero false authorizations and zero unauthorized side effects in the critical
   evaluation suite, including end-to-end deterministic-policy checks. Zero observed
   failures is necessary but does not establish zero production risk.
3. Record numeric thresholds for per-state action accuracy, ambiguity detection,
   unnecessary clarification, schema failures, p95 latency, and cost per completed expense
   before evaluating the candidate. Product Owner and Tech Lead must approve those
   budgets against the measured deterministic baseline; activation is blocked while any
   threshold is unspecified or unmet. Preserve the existing acknowledgment target.
4. Run shadow evaluation without model-driven state changes or business side effects.
   Measure proposed-action quality there; validate actual task completion in a controlled,
   limited rollout, since shadow proposals cannot demonstrate completion improvements.
5. Expand only when task completion improves against the baseline, the recorded budgets
   are met, and critical safety checks remain green. Roll back the affected cohort on
   any observed false authorization or a breach of its recorded release budgets.

Feature flags must support per-state rollout and rollback to deterministic routing
without a data migration. Re-run the applicable gates for model, prompt, contract, or
policy changes. Implementation documentation must record the measured baseline,
thresholds, dataset versions, and rollout results before activation.

## Rationale

- The primary product problem is semantic interpretation, not state persistence or business execution.
- Routing is a bounded classification problem with known downstream workflows, so an open-ended agent is unnecessary.
- A typed proposal gives the LLM flexibility over language without granting authority over effects.
- The existing FSM and use cases already encode valuable safety, recovery, and audit behavior.
- Deterministic mediation and human confirmation reduce the risk of hallucination, prompt injection, and excessive agency.
- Keeping the router behind a port preserves the provider independence established by ADR-002.
- Avoiding MCP internally keeps the architecture proportional to the current monolith while leaving external interoperability possible later.

## Consequences

### Positive

- Users can communicate naturally without memorizing exact phrases.
- Language understanding becomes state-aware and consistent across conversational flows.
- Business invariants, authorization, persistence, and external mutations remain deterministic.
- Ambiguity becomes an explicit product state rather than an accidental routing failure.
- The semantic component can be evaluated, versioned, replaced, and rolled back independently.
- Existing use cases, FSM persistence, queues, locks, and confirmation flows remain reusable.

### Negative

- More free-text turns depend on an external model and inherit variable latency and availability.
- The decision schema and state-to-action policy become new contracts that must evolve together.
- Model upgrades require regression evaluation across every supported state and language pattern.
- Natural-language behavior cannot be proven exhaustively; monitoring and continuous evals are required.
- Supporting both shadow/fallback routing and the new router temporarily increases operational complexity.

## Compatibility and Implementation Follow-up

- ADR-003 remains authoritative for persisted FSM transitions; semantic proposals are
  inputs to that policy, not a second state machine.
- ADR-006 remains authoritative for save outcomes and user-visible success messages;
  ADR-018 remains authoritative for user-initiated retry limits.
- ADR-011 retains the two-queue pipeline and per-user serialization. This decision
  refines routing placement so semantic work occurs in the processing worker.
- ADR-017's explicit immediate-undo exception is preserved. This decision extends its
  confirmation flow to all semantically inferred undo requests.
- Before activation, document implemented behavior and evaluation/rollout settings in
  `docs/features/incoming-message-routing.md` and synchronize its directory index.
  Update `docs/architecture/fsm-states.md` with the actual state/substep policy, including
  `EXPENSE_UNDO_CONFIRMING`, which is absent from its current state table. These are
  implementation follow-ups; this ADR does not claim they are already delivered.

## References

- [ADR-002: Use LLM with Structured Extraction via Abstracted Port](./ADR-002-llm-extraction.md)
- [ADR-003: Persist Conversational FSM in PostgreSQL](./ADR-003-fsm-postgresql.md)
- [ADR-006: Implement Write-with-Confirmation and Retry for Save Reliability](./ADR-006-write-confirmation.md)
- [ADR-011: Two-Queue Pipeline for FIFO Message Ordering](./ADR-011-two-stage-pipeline.md)
- [ADR-017: Require Confirmation for Delayed Expense Undo](./ADR-017-undo-confirmation-fsm.md)
- [ADR-018: Limit Unconfirmed Spreadsheet Save Retries to One User-Initiated Attempt](./ADR-018-user-initiated-save-retry.md)
- [Feature: Receive, Parse and Route Incoming Messages](../features/incoming-message-routing.md)
- [Architecture: FSM States](../architecture/fsm-states.md)
- [Anthropic: Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Model Context Protocol Specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [Model Context Protocol: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [OpenAI: A Practical Guide to Building AI Agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)
- [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
