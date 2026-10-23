# Fix expense extraction failures

**Status: Closed by user acceptance on 2026-10-03.**

## Goal

Make initial expense extraction return a valid review or a truthful, recoverable failure within a bounded provider deadline. Diagnose and correct empty LLM output without losing conversation ownership, fabricating expense data, or writing a spreadsheet before explicit confirmation.

## Context

The user approved the three-phase proposal on 2026-09-23, including the proposed contracts and a 30-second extraction timeout. The user subsequently authorized execution of all three phases without intermediate pauses, followed by one commit and push of the current branch.

### Incident evidence

- The supplied logs show `semantic_router_observation` at 17:57:20.262 with `state: EXPENSE_RECEIVING`, `mode: off`, and `deterministicDecision: fsm_handler`. At 17:59:40.936, processing fails with `LLM returned empty response`, approximately 141 seconds later, then sends the generic fallback.
- Observation occurs after per-user lock acquisition. The recent contention-retry change in commit `c75a197` does not address this downstream failure.
- The error text exists in both NVIDIA and OpenAI adapters. Provider identity, response termination reason, and the cause of empty content are not established by the supplied logs. Elapsed handler time is not proof of provider-only latency.
- At incident analysis time, NVIDIA extraction used `max_tokens: 512`, reads only `choices[0].message.content`, and had no explicit application request deadline. Token exhaustion is a hypothesis to verify, not an established diagnosis.
- Initial interpretation enters `EXPENSE_RECEIVING` before extraction. The worker's generic error catch sends “Vamos a empezar de nuevo” without resetting that state. That catch is outside the `runWithState` execution context, so an unconditional reset there would not be a safe fix.
- Non-financial guidance can be sent from ingress while the state is `EXPENSE_RECEIVING`; receiving a reply to “hola” does not establish completion of an expense job.

### Relevant implementation

Paths below are relative to this plan directory.

- [NVIDIA adapter](../../../src/infrastructure/adapters/llm/NvidiaAdapter.ts), [OpenAI adapter](../../../src/infrastructure/adapters/llm/OpenAIAdapter.ts), and [Claude adapter](../../../src/infrastructure/adapters/llm/ClaudeAdapter.ts): provider extraction, parsing, SDK retry settings, and transport cancellation.
- [RegisterExpense](../../../src/application/use-cases/expense/RegisterExpense.ts): initial extraction, user context, classification, and transition to review.
- [Message worker](../../../src/interfaces/workers/message.worker.ts): execution ownership, error handling, and summary presentation.
- [TransitionConversationState](../../../src/application/use-cases/conversation/TransitionConversationState.ts): owned execution context, invalidation signal, revision preconditions, and compare-and-swap transitions.
- [RouteIncomingMessage](../../../src/application/use-cases/conversation/RouteIncomingMessage.ts): guidance and expense admission.
- [Dependency wiring](../../../src/bootstrap/buildDependencies.ts), [environment schema](../../../src/config/env.schema.ts), and [expense copies](../../../src/application/copies/expense.copies.ts).

### Required conventions and documentation

- [AGENTS.md](../../../AGENTS.md), [plan conventions](../../../docs/plans/plan-conventions.md), and [testing guidelines](../../../docs/testing/guidelines.md).
- [ADR index and decisions](../../../docs/adr/adr.md): provider abstraction, conversation FSM, asynchronous processing, and confirmation before writing.
- [ADR-025](../../../docs/adr/ADR-025-process-message-lock-contention.md): contention retries and side-effect safety.
- [Incoming routing](../../../docs/features/incoming-message-routing.md), [conversation state](../../../docs/features/conversation-state-management.md), and [expense review](../../../docs/features/expense-summary-review.md).
- [Configuration](../../../docs/architecture/config-env.md) and [observability](../../../docs/architecture/observability.md).

Use constructor-injected Pino logging and boundary mocks; do not mock core business logic in the regression scenarios. Read configuration structure from `.env.example`, never secret files. The old template path `docs/adr/template.md` is absent. Implementation located and used the current template at `docs/templates/adr.md`, linked from the ADR README.

## Phases

### Phase 1: Make extraction failures diagnosable

Deliver an executable diagnostic slice: a simulated empty provider response produces a typed failure and correlated, privacy-safe operational logs through the real extraction flow.

#### Public contracts

- Add an application-boundary `LLMExtractionError` with stable codes: `LLM_TIMEOUT`, `LLM_EMPTY_RESPONSE`, `LLM_OUTPUT_TRUNCATED`, `LLM_INVALID_JSON`, `LLM_INVALID_SCHEMA`, and `LLM_PROVIDER_ERROR`. It carries allowlisted operational metadata, never raw provider bodies or user content.
- Emit `llm_extraction_started` and `llm_extraction_completed`. Shared fields: correlation ID, provider, model, and operation `extract_expense`. Completion fields: duration, outcome, error code when applicable, and optional HTTP status, finish reason, and token counts. Treat missing provider metadata as unknown, not zero.
- Carry job correlation through the initial extraction path using an optional execution context, preserving other extraction callers. Record durations for context loading, extraction, and summary presentation so provider latency can be distinguished from surrounding work.

#### To-do actions

- [x] Trace all extraction callers before changing shared contracts and verify source coverage for newly discovered paths.
- [x] Implement typed failures and request/completion telemetry for the three extraction adapters, wired through bootstrap and the initial expense flow. Prefer a small shared contract over duplicated classification rules.
- [x] Validate response shape and distinguish absent/blank content, reported truncation, invalid JSON, invalid expense schema, and transport/HTTP failure. Do not log validation inputs or raw exception messages containing provider content.
- [x] Update adapter suites to cover successful extraction, empty choices/content, whitespace-only content, truncation, malformed JSON, schema rejection, and provider errors. Assert one terminal telemetry event and correct duration/outcome metadata.
- [x] Add sanitization and worker-correlation assertions, including missing usage metadata and sensitive provider errors. Produce a sanitized fixture showing the diagnostic result.
- [x] Update observability documentation and canonical routing/review documentation as applicable, with `docs/features/README.md` updated alongside feature files.
- [x] Run `pnpm test` and resolve failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase. The user explicitly requested proceeding through all phases without pauses.

### Phase 2: Bound extraction and recover the initial expense safely

Deliver a bounded failure response followed by a successful fresh attempt. Recovery belongs inside the owned application execution context and applies only to the initial extraction operation before review or financial side effects.

#### Public contracts

- Add `LLM_EXTRACTION_TIMEOUT_MS`, default `30000`, integer range `1000..60000`, in environment validation, bootstrap wiring, configuration documentation, and `.env.example`. This bounds the provider operation, not queue waiting or the entire database-and-messaging pipeline.
- Extend extraction execution options with an optional `AbortSignal`; combine ownership cancellation with the extraction deadline. SDK retries must not extend the total provider budget. Do not retry the whole BullMQ handler for extraction failures.
- Application recovery takes the observed initial-extraction state/revision and returns `recovered` or `stale`. Reset only the matching `EXPENSE_RECEIVING` attempt to `IDLE`, clearing its payload and expiry. A stale result must not claim a reset or overwrite a newer conversation.
- Add dedicated initial-extraction copies:
  - Timeout: “La interpretación tardó demasiado. No guardé este gasto. Volvé a enviarlo para intentar de nuevo”.
  - Invalid provider output: “No pude interpretar este gasto. No lo guardé. Volvé a enviarlo para intentar de nuevo”.
- Other extraction provider failures use the same truthful failure guidance where recovery succeeded. Keep the generic handler separate from this narrowly scoped recovery.

#### To-do actions

- [x] Wire the deadline through all extraction adapters. Abort the transport and response-body read, clean up timers/listeners, and prevent late completion from causing state or presentation effects. A bare `Promise.race` leaving a live request is insufficient.
- [x] Implement recovery in the application layer while the lock and latest execution snapshot remain available. Use existing revision/ownership checks; do not obtain a fresh snapshot merely to reset whatever state happens to exist later.
- [x] On successful recovery send exactly one appropriate failure message. If recovery persistence fails, log the safe operational cause and avoid falsely claiming the conversation restarted.
- [x] Preserve clarification/correction drafts, queued expenses, newer reviews, and unresolved financial claims. Audit shared extraction callers so the initial-expense reset cannot affect these flows.
- [x] Add adapter tests for deadline expiry before headers and during body consumption, successful completion, ownership cancellation, cleanup, and bounded SDK retry behavior.
- [x] Add regression tests through the real application flow: start in `IDLE` and pre-existing `EXPENSE_RECEIVING`; fail extraction; return to `IDLE`; release the lock; resend successfully and reach review. Assert zero spreadsheet writes and zero saved expenses on failure.
- [x] Test stale revision, lost ownership, failed recovery persistence, late provider completion, and protection of active review/save states. Use real PostgreSQL/Redis integration where needed to verify atomic transitions and lock behavior.
- [x] Update routing, conversation-state, review, configuration, and observability docs where behavior changes. Update feature indexes and document deadline/recovery tradeoffs in an ADR with its README entry.
- [x] Run `pnpm test` and resolve failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase. The user explicitly requested proceeding through all phases without pauses.

### Phase 3: Correct the provider cause and validate confirmed saving

Use captured diagnostic evidence to fix the concrete empty-output cause and verify the full user journey. A graceful timeout alone is not evidence that valid expenses can be registered again.

#### Public contracts

- Modify only the implicated provider's extraction request/response contract as justified by observed metadata and official provider documentation. Examples include output budget or supported structured-output options; do not choose either before evidence supports it.
- Extend adapter and end-to-end regression suites with a sanitized reproduction of the actual response shape and the confirmed-save journey.

#### To-do actions

- Deferred at closure: capture deployment telemetry identifying provider, model, termination reason, duration, and usage. No such capture was provided; the user accepted closure after confirming that expense registration works. The historical provider cause remains unverified.
- [x] If truncation is demonstrated, validate a suitable generation budget/model setting. If content shape or provider errors are responsible, correct that handling instead. Verify model-specific options against official documentation before implementation.
- [x] Never parse reasoning text as the expense, invent missing fields, silently save a fallback expense, or add unbounded retries. Keep the configured deadline effective after request changes.
- Deferred at closure: a captured provider failure fixture remains unavailable. Automated fixtures are synthetic. User acceptance closes the registration incident, not the historical root-cause investigation.
- [x] Exercise webhook through worker, real application logic, state persistence, and mocked external provider/sheets/messaging boundaries: `almuerzo 200 euros` produces a 200 EUR review, explicit confirmation writes once, and duplicate confirmation does not write again. Also exercise extraction failure followed by a successful resend.
- [x] Verify the initial-expense path with semantic routing off, matching the incident, and run relevant existing semantic/clarification/correction regression coverage for shared adapter changes.
- [x] Record user validation of restored expense registration and explicit acceptance of plan closure on 2026-10-03. The user reported that registration works. They did not supply a deployed revision, provider telemetry, or detailed live confirmation/timeout evidence; those checks are not claimed as performed.
- [x] Update canonical feature docs/indexes and the ADR/index with the demonstrated cause and final behavior. Record any outstanding live validation explicitly. Update linked user-story acceptance tasks only when actually fulfilled.
- [x] Run `pnpm test` and resolve failures; record the automated and live validation results separately.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase. The user explicitly requested proceeding through all phases without pauses.

## Next step

This plan is closed; investigate the separately reported category/subcategory assignment problem only when the user requests that follow-up.

## Execution evidence and closure

Phases 1 and 2 are implemented. Phase 3 includes the GLM request compatibility correction, automated end-to-end regression coverage, and user confirmation that expense registration works. The user explicitly requested closing this plan before investigating the additional findings. Closure is based on that acceptance; the original telemetry capture and captured failure fixture are deferred, not completed.

- Added `LLM_CANCELLED` to distinguish ownership cancellation from timeout, avoiding a false provider-failure recovery.
- Recovery is implemented in `RecoverExpenseExtraction`, called inside `RegisterExpenseUseCase` before leaving the owned state context; the worker presents a dedicated message only after committed recovery.
- The initial extraction options preserve shared caller compatibility. Batch markers, non-initial states, newer revisions, and financial claims prevent this reset.
- Official NVIDIA documentation confirms GLM-5.3-Flash defaults to maximum reasoning and separates reasoning from final output. The exact-model request now uses `reasoning_effort: low` and a finite 4096-token cap. This is a compatibility correction based on the documented model behavior, not a claim that the production incident's cause was observed. The 30-second deadline remains effective.
- Regression fixtures are synthetic and explicitly test reasoning-only/truncated output, empty output, malformed data, cancellation, and a successful final answer. They are not captured production responses.
- Real PostgreSQL/Redis integration tests exercise routing off, failures from both `IDLE` and `EXPENSE_RECEIVING`, recovery, resend, review, and exactly one confirmed write. Network/SDK responses and spreadsheet/messaging boundaries are simulated.
- The agent did not perform a live provider request or deployment and did not read production data or credentials. On 2026-10-03, the user reported successful registration during their own testing. Provider identity and the exact historical reason for empty output remain unverified.
- The user also reported incorrect categories/subcategories and other unspecified findings. These are a separate follow-up; this closure does not certify classification correctness or include its investigation.
- No matching incident user-story task was supplied; no unrelated backlog acceptance criteria were marked complete.

See [validation record](./validation.md) for automated evidence, user acceptance, and the limits of the available live evidence.
