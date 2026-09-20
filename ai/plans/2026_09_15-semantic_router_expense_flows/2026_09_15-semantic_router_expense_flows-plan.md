# Plan: Semantic Router Expense Flows

## Goal

Enable the constrained semantic router for expense recognition, missing-data replies, and active-review corrections through three vertical deliveries. Preserve deterministic confirmation, state validity, pending-expense ordering, and the original user message across every path.

## Context

- [Master plan, Phase 4](../2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md): Approved expense-flow scope, contracts, scenarios, and closure evidence.
- [Phase 1 evaluation plan](../2026_09_11-semantic_router_evaluation/2026_09_11-semantic_router_evaluation-plan.md) and [semantic-router evaluation feature](../../../docs/features/semantic-router-evaluation.md): Implemented proposal vocabulary, state/action policy, strict provider boundary, development and held-out corpora, and remaining live-evaluation limits.
- [Phase 2 confirmation-safety plan](../2026_09_12-semantic_router_confirmation_safety/2026_09_12-semantic_router_confirmation_safety-plan.md) and [conversation-state management](../../../docs/features/conversation-state-management.md): Revisioned state preconditions, renewable per-user ownership, review bindings, financial claims, and stale-context behavior.
- [Phase 3 shadow-pipeline plan](../2026_09_14-semantic_router_shadow_pipeline/2026_09_14-semantic_router_shadow_pipeline-plan.md): Current off, shadow, and fail-closed enabled modes; bounded projection; safe observation; telemetry; queue compatibility; and deterministic fallback behavior.
- [ADR-023](../../../docs/adr/ADR-023-constrained-llm-semantic-router.md), [ADR-002](../../../docs/adr/adr.md), and [FSM states](../../../docs/architecture/fsm-states.md): Semantic authority boundaries, provider-independent extraction, state transitions, and explicit confirmation requirements.
- [Message worker](../../../src/interfaces/workers/message.worker.ts), [RouteIncomingMessage](../../../src/application/use-cases/conversation/RouteIncomingMessage.ts), [semantic observation](../../../src/application/services/semantic-router/ObserveSemanticRouting.ts), [input projection](../../../src/application/services/semantic-router/ProjectSemanticRouterInput.ts), and [runtime policy](../../../src/application/services/semantic-router/runtime-policy.ts): Integration seam after identity validation, lock acquisition, and current-state loading.
- [Semantic contracts](../../../src/application/services/semantic-router/contracts.ts), [state/action policy](../../../src/application/services/semantic-router/policy.ts), [SemanticRouterPort](../../../src/domain/ports/SemanticRouterPort.ts), and [conversation decision](../../../src/domain/value-objects/conversation-decision.ts): Existing closed proposal contract to reuse without adding confirmation or model-owned identifiers.
- [RegisterExpenseUseCase](../../../src/application/use-cases/expense/RegisterExpense.ts), [ResolveExpenseReviewReplyUseCase](../../../src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase.ts), [CorrectExpenseUseCase](../../../src/application/use-cases/expense/CorrectExpenseUseCase.ts), [clarification state](../../../src/domain/value-objects/expense-clarification-state.ts), and [review payload](../../../src/domain/value-objects/expense-review-payload.ts): Existing interpretation, clarification, correction, and review behavior.
- [QueuePendingExpense](../../../src/application/use-cases/expense/QueuePendingExpense.ts) and [AdvancePendingExpense](../../../src/application/use-cases/expense/AdvancePendingExpense.ts): Existing two-item FIFO admission and sequential advancement rules.
- [Incoming routing](../../../docs/features/incoming-message-routing.md), [clarification](../../../docs/features/clarification-request.md), [review](../../../docs/features/expense-summary-review.md), [correction](../../../docs/features/expense-correction.md), and [confirmation](../../../docs/features/expense-confirmation.md): Canonical behavior and application-owned copy to preserve and update.
- [Testing guidelines](../../../docs/testing/guidelines.md): Required unit, FSM, PostgreSQL/Redis integration, negative side-effect, and external-boundary testing rules.
- [Evaluation corpus](../../../evals/semantic-router/corpus.json), [manifest](../../../evals/semantic-router/manifest.json), and [dataset documentation](../../../evals/semantic-router/README.md): Versioned scenarios to extend without relabeling held-out cases after results are seen.

### Revalidated prerequisites

- Phase 1 remains implemented through `semantic-contract-v1`, `semantic-policy-v1`, `SemanticRouterPort.decide`, strict schema assessment, and the structured OpenAI adapter. The recorded offline corpus evidence is 175 development and 25 held-out cases with zero critical failures; no live-provider accuracy, task-completion, latency, or cost evidence exists.
- Phase 2 remains implemented through monotonic conversation revisions, renewable Redis ownership, state/action bindings, exact deterministic authorization inputs, and durable financial-effect claims. These contracts must guard every semantic dispatch, and migration `0009` still requires coordinated deployment outside this plan.
- Phase 3 remains implemented with unchanged incoming and processing job schemas, state loading under the per-user lock, allowlisted context projection, snapshot revalidation, sanitized telemetry, and deterministic non-interference. Its PostgreSQL/Redis suite passed 17 scenarios and the recorded full suite passed 2,031 tests; live provider observation and production activation remain pending.
- `ObserveSemanticRouting` currently returns metadata only. An `enabled` resolution records `ENABLED_CAPABILITY_UNAVAILABLE` and executes the deterministic route, so Phase 4 needs a typed turn result and an expense-only dispatcher before any enabled expense state is valid.
- The current review resolver classifies confirmation and cancellation lexically before invoking `CorrectExpenseUseCase`, while correction interpretation can independently return `new_expense` or `unrelated`. A validated semantic action must enter an action-specific path so a second intent classification cannot redirect it.
- Clarification currently retains the original expense message and combines it with the raw reply before rerunning extraction. Review interruptions use the two-item pending queue, while clarification interruptions replace the incomplete draft. Phase 4 must retain those distinct rules.

### Delivery boundaries

- Use three vertical deliveries: enabled recognition in `IDLE` and `EXPENSE_RECEIVING`, stateful clarification and review dispatch, then integrated evaluation and rollback hardening.
- Enable only `register_expense`, `provide_missing_expense_data`, `correct_expense`, `request_clarification`, and `out_of_scope` in the state/substep combinations defined below. Cancellation, option selection, undo, retry, reconfiguration, save confirmation, and every unsupported state remain deterministic or fail closed for later master-plan phases.
- Typed callbacks and whole-message sensitive commands bypass the model. In particular, confirmation continues through its existing authorization binding and never appears in the semantic proposal or dispatch contract.
- A router failure, forbidden action, stale snapshot, invalid context, unsupported capability, or unresolved mixed intent produces either an exact existing deterministic bypass or bounded application-owned clarification. It never invokes a broader intent resolver as fallback and never mutates state, queues, expenses, or spreadsheets by itself.
- Pass the application-retained original message and current raw reply to existing extraction/correction boundaries. Never execute model-generated rewritten text and never add a second semantic-router call for extraction repair.
- Keep both BullMQ job schemas, current database schemas, queue capacity, and stored review/clarification payload compatibility unchanged. No migration, dependency, route, or provider switch is planned.
- Implementing a capability does not activate it. State modes and cohorts remain off by default; live evaluation budgets and production rollout remain master Phase 7.

### Public contracts

#### Per-state enabled capability matrix

The runtime capability layer must narrow `semantic-policy-v1`, not broaden it:

| State                | Enabled semantic actions in this phase                                                      | Deterministic-only behavior                                       |
| -------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `IDLE`               | `register_expense`, `request_clarification`, `out_of_scope`                                 | Immediate undo and every typed callback                           |
| `EXPENSE_RECEIVING`  | `register_expense`, `request_clarification`, `out_of_scope`                                 | Exact cancellation                                                |
| `EXPENSE_CLARIFYING` | `provide_missing_expense_data`, `register_expense`, `request_clarification`, `out_of_scope` | Exact cancellation                                                |
| `EXPENSE_REVIEW`     | `correct_expense`, `register_expense`, `request_clarification`, `out_of_scope`              | Confirmation callback, exact confirmation, and exact cancellation |

`register_expense` in `EXPENSE_REVIEW` means admission to the existing pending queue without replacing or saving the active review. The same action in `EXPENSE_CLARIFYING` preserves the existing interruption rule: cancel the incomplete draft, notify the user, and interpret the new original message. Unknown substeps and every unlisted state/action pair remain unavailable.

#### Turn resolution

Evolve the Phase 3 orchestration behind an application-owned interface while retaining one router call and one telemetry event:

```typescript
type ExpenseSemanticDecision = Extract<
  ConversationDecision,
  | { action: 'register_expense' }
  | { action: 'provide_missing_expense_data' }
  | { action: 'correct_expense' }
  | { action: 'request_clarification' }
  | { action: 'out_of_scope' }
>;

type SemanticRoutingTurnOutcome =
  | { readonly status: 'deterministic'; readonly reason: SemanticFallbackReason }
  | {
      readonly status: 'expense_action';
      readonly decision: ExpenseSemanticDecision;
      readonly expected: ConversationStatePrecondition;
    }
  | {
      readonly status: 'clarification';
      readonly reason: 'ambiguous_intent' | 'mixed_intents' | 'unsupported_action';
    };

interface ResolveSemanticRoutingTurn {
  execute(input: {
    readonly userId: string;
    readonly externalMessageId: string;
    readonly rawMessage: string;
    readonly conversationState: ConversationState;
    readonly deterministicDecision: DeterministicRoutingDecision;
  }): Promise<SemanticRoutingTurnOutcome>;
}
```

- `off` and `shadow` retain Phase 3 behavior. `shadow` records the proposal and returns `deterministic`.
- `enabled` returns `expense_action` only after projection, schema assessment, state/action capability checking, and post-model snapshot validation. The returned precondition binds dispatch to the same current state, revision, expiry, and absence of unresolved claims.
- Deterministic bypasses return before any model call. Unsupported enabled actions retain `ENABLED_CAPABILITY_UNAVAILABLE` semantics until their master-plan phase supplies a dispatcher.
- Telemetry extends the current outcome vocabulary to distinguish `allowed_enabled`, `dispatch_rejected`, and `dispatch_failed` without recording raw text, identifiers, payloads, bindings, or provider bodies.

#### Expense action dispatch

Add a typed application entry point that receives no arbitrary target state and no save/delete/retry capability:

```typescript
interface DispatchExpenseSemanticActionInput {
  readonly userId: string;
  readonly externalId: string;
  readonly externalMessageId: string;
  readonly receivedAt: string;
  readonly channel: 'telegram' | 'whatsapp';
  readonly rawMessage: string;
  readonly conversationState: ConversationState;
  readonly expected: ConversationStatePrecondition;
  readonly decision: ExpenseSemanticDecision;
}

type DispatchExpenseSemanticActionOutcome =
  | { readonly status: 'review_required'; readonly payload: ExpenseReviewPayload }
  | { readonly status: 'missing_data'; readonly field: 'monto' | 'moneda' }
  | { readonly status: 'expense_queued'; readonly pendingCount: 1 | 2 }
  | { readonly status: 'queue_full'; readonly pendingCount: 2 }
  | { readonly status: 'clarification_required'; readonly reason: ExpenseGuidanceReason };

interface DispatchExpenseSemanticAction {
  execute(input: DispatchExpenseSemanticActionInput): Promise<DispatchExpenseSemanticActionOutcome>;
}
```

- The dispatcher revalidates the Phase 2 precondition immediately before handing off and invokes exactly one action-specific path. It cannot call `RegisterExpenseUseCase.save`, spreadsheet ports, deletion, retry, generic raw-state transitions, or `ResolveExpenseReviewReplyUseCase`.
- `register_expense` in idle/receiving calls `RegisterExpenseUseCase.interpret`; in clarification it uses the current interruption behavior; in review it calls `QueuePendingExpense` directly.
- `provide_missing_expense_data` accepts only a valid `ExpenseClarificationState`, combines its retained `rawMessage` with the current raw reply through a dedicated completion use case, and runs the existing extractor once.
- `correct_expense` accepts only a valid normalized review payload, creates `ExpenseCorrectionState`, and invokes correction extraction once. Add an explicit `intentMode: 'infer' | 'validated_correction'` to `CorrectExpenseInput`; in validated mode, an extraction result of `new_expense`, `unrelated`, or no changed fields becomes controlled clarification and cannot redirect to queue admission or confirmation.
- Keep `LLMPort.extractExpense`, `LLMPort.interpretCorrection`, `ExtractedExpense`, `ExpenseReviewPayload`, and persisted clarification/review payload shapes compatible. Existing deterministic callers use `intentMode: 'infer'`.

#### User-facing copies and evaluation

- Map semantic clarification reasons to bounded copies in `expense.copies.ts`. Active clarification/review copies restate the pending question or review choices without replacing state; idle/receiving copies reuse expense guidance. Do not display provider errors, model output, confidence, or hidden reasoning.
- Extend versioned development and held-out evaluation cases per state. Record router calls and extraction/correction calls separately, including total calls per completed review; do not report shadow agreement as task completion or enable a cohort merely because implementation tests pass.

## Phases

### Phase 1: Deliver enabled expense recognition in idle and receiving states

#### Description

Replace the fail-closed enabled guard for `register_expense` in `IDLE` and `EXPENSE_RECEIVING` with a runnable typed path to the existing interpretation and review flow, while keeping all sensitive commands and fallback behavior deterministic.

#### To-do actions

- [x] Add the expense capability matrix and `SemanticRoutingTurnOutcome`; evolve Phase 3 orchestration so off/shadow behavior is unchanged and enabled mode can return one validated expense action with its snapshot precondition.
- [x] Implement the initial `DispatchExpenseSemanticAction` slice for `register_expense` in `IDLE` and `EXPENSE_RECEIVING`, passing the original `rawMessage` to `RegisterExpenseUseCase.interpret` and reusing existing missing-data, zero-amount, and review presentation outcomes.
- [x] Keep exact undo, callback, confirmation, retry, and cancellation inputs on their existing deterministic bypasses with zero semantic-router calls. Return controlled guidance for router failure, malformed output, stale context, forbidden action, and unavailable capability without effects.
- [x] Cover the canonical multiline Mercadona notification and variants. Assert one extracted expense with amount `16.55`, currency `EUR`, date `2026-09-11`, and concept `Mercadona`; preserve the original multiline text, treat card/bank labels as payment context, and do not infer a timezone.
- [x] Add unit and worker tests for off/shadow equivalence, enabled recognition, ordinary expense text, missing amount/currency, zero amount, high amount, unrelated text, provider failure, stale revision, lease loss, and one router plus one extraction call at most.
- [x] Assert that enabled recognition reaches `EXPENSE_REVIEW` or `EXPENSE_CLARIFYING` only, sends no save confirmation, creates no expense record, appends no spreadsheet row, and does not change either BullMQ payload schema.
- [x] Update incoming-routing, semantic-router evaluation, review/clarification, configuration, observability, and FSM documentation for the implemented idle/receiving capability; update `docs/features/README.md`.
- [x] Run focused tests and `pnpm test`; keep real-provider evaluation and state/cohort activation explicitly pending.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Deliver stateful clarification, correction, and additional-expense dispatch

#### Description

Enable action-specific semantic handling in `EXPENSE_CLARIFYING` and `EXPENSE_REVIEW` so short answers, corrections, and new-expense interruptions reuse current business invariants without a conflicting second intent classification.

#### To-do actions

- [x] Extract clarification completion into an application use case that validates `ExpenseClarificationState`, retains its original message, combines only the current raw reply, preserves `queueRegisteredCount`, and returns existing interpretation outcomes.
- [x] Add `intentMode` to `CorrectExpenseInput` and update deterministic callers to use `infer`; implement `validated_correction` so correction-field extraction can update the active review but cannot reclassify the turn as confirmation, cancellation, or a new expense.
- [x] Extend `DispatchExpenseSemanticAction` for `provide_missing_expense_data` and `register_expense` in `EXPENSE_CLARIFYING`, preserving replacement of the incomplete draft, clarification reformulation, zero/high-amount guards, and original-message continuity.
- [x] Extend dispatch for `correct_expense` and `register_expense` in `EXPENSE_REVIEW`. Corrections create a new review binding and require presentation plus fresh explicit confirmation; new expenses enter `QueuePendingExpense` without replacing or saving the active review.
- [x] Preserve category/subcategory parent-child validation, correction-cycle limits, date/amount/currency contracts, queue capacity of two, FIFO ordering, queue overflow with unchanged review, and `queueRegisteredCount` continuity through clarification, correction, save, cancellation, and advancement.
- [x] Keep `sí, pero cambia el importe a 25` on the validated correction path and present a new review for amount `25`; route unresolved mixed intents to controlled clarification with no state, queue, record, or spreadsheet mutation.
- [x] Test short amount/currency answers, complete bank notifications during clarification, explicit replacement versus ambiguous interruption, amount-bearing corrections, new expenses during review, unrelated text, invalid subcategories, correction-cycle exhaustion, queue overflow, legacy payload normalization, and extraction/correction failures.
- [x] Add negative assertions that only explicit bound confirmation saves the corrected amount exactly once, old review bindings cannot save, failed extraction leaves no partial effects, and a semantic `register_expense` during review never invokes correction interpretation.
- [x] Update clarification, review, correction, confirmation, conversation-state, FSM, routing, and semantic-router documentation for the implemented stateful behavior; update `docs/features/README.md`.
- [x] Run focused tests and `pnpm test`; keep option selection and control-flow proposals unavailable for their later phases.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Prove end-to-end safety, evaluation coverage, and rollback compatibility

#### Description

Close the expense capability with conversation-level PostgreSQL/Redis evidence, held-out evaluation reporting, privacy-safe observability, and an exercised rollback to deterministic routing without data or queue migration.

#### To-do actions

- [x] Add a PostgreSQL/Redis integration suite spanning idle recognition, clarification completion, correction review, additional-expense queueing, explicit save, cancellation, queue advancement, duplicate delivery, lock contention, lease loss, and a revision change while the model or extractor is pending.
- [x] Add end-to-end webhook-to-worker conversations for the canonical Mercadona notification and state-dependent variants. Assert exactly one final expense for `16.55 EUR` on `2026-09-11`, exact preservation of the source text, no timezone inference, and no save before the bound confirmation shown after the latest review.
- [x] Prove provider timeout/refusal/invalid output, unsupported action, invalid legacy payload, failed extraction/correction, telemetry failure, queue overflow, and stale preconditions retain controlled state and produce zero unauthorized writes, deletes, retries, or success messages.
- [x] Exercise `enabled` to `shadow` and `off` rollback with jobs already queued and active clarification/review states. Existing job and state payloads must continue deterministically with no dead letter, migration, duplicate interpretation, or lost pending expense.
- [x] Extend the versioned corpus with independently labeled stateful conversations for short replies, bank notifications, corrections, new-expense interruptions, negation, mixed intents, unrelated text, prompt injection, legacy state, and failures. Keep held-out families isolated and immutable after candidate results are inspected.
- [x] Report per-state action agreement, ambiguity and unnecessary-clarification rates, critical false-authorization results, router/extraction/correction call counts, test-observed latency, and missing live/task-completion/cost evidence. Define Phase 4 activation prerequisites without setting unapproved Phase 7 release budgets.
- [x] Capture telemetry assertions for `allowed_enabled`, rejection, dispatch failure, state/substep, action, provider/model, prompt/contract/policy versions, and latency while excluding raw messages, payloads, user/external IDs, operation bindings, claims, credentials, provider bodies, and reasoning.
- [x] Update routing, semantic-router evaluation, clarification, review, correction, confirmation, conversation-state, async-pipeline, observability, configuration, and FSM documentation with delivered capability and rollback behavior; update `docs/features/README.md` and the master tracking table with verified evidence only.
- [x] Run the complete PostgreSQL/Redis integration suites and `pnpm test`; any skipped expense-flow suite remains pending evidence and blocks completion.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Review the completed expense-flow delivery and continue with master Phase 5 for semantic option selection when approved.
