# Plan: Semantic Router Confirmation Safety

## Goal

Bind deterministic expense actions to the exact pending operation and displayed review, and reject expired or superseded context before any save, deletion, or retry. Deliver the safety prerequisite for master Phase 3 without integrating or enabling semantic routing.

## Context

This is the delivery plan for [master Phase 2](../2026_09_11-master_constrained_semantic_router/2026_09_11-master_constrained_semantic_router-plan.md). Phase 1 is implemented and verified; Phases 2 and 3 remain pending. This document does not approve deployment or execute a migration against a user-configured database.

### Required context and predecessor

- [Repository instructions](../../../AGENTS.md), [plan conventions](../../../docs/plans/plan-conventions.md), [ADR index](../../../docs/adr/adr.md), [ADR-023](../../../docs/adr/ADR-023-constrained-llm-semantic-router.md), [ADR-011](../../../docs/adr/ADR-011-two-stage-pipeline.md), [ADR-017](../../../docs/adr/ADR-017-undo-confirmation-fsm.md), and [ADR-018](../../../docs/adr/ADR-018-user-initiated-save-retry.md).
- [Phase 1 plan](../2026_09_11-semantic_router_evaluation/2026_09_11-semantic_router_evaluation-plan.md), [evaluation feature](../../../docs/features/semantic-router-evaluation.md), [SemanticRouterPort](../../../src/domain/ports/SemanticRouterPort.ts), and [runtime contracts](../../../src/application/services/semantic-router/contracts.ts).
- [Confirmation](../../../docs/features/expense-confirmation.md), [review](../../../docs/features/expense-summary-review.md), [correction](../../../docs/features/expense-correction.md), [state management](../../../docs/features/conversation-state-management.md), [undo](../../../docs/features/undo-last-expense.md), [cancellation](../../../docs/features/expense-cancellation.md), [incoming routing](../../../docs/features/incoming-message-routing.md), and [cloud connection](../../../docs/features/cloud-storage-connection.md).
- [FSM payloads](../../../docs/architecture/fsm-states.md), [data model](../../../docs/architecture/data-model.md), [configuration](../../../docs/architecture/config-env.md), and [testing guidelines](../../../docs/testing/guidelines.md).

Phase 1 revalidation: `SemanticRouterPort.decide(input): Promise<SemanticRouterResult>` still returns a proposal or typed failure. `semantic-contract-v1` has ten closed actions and no confirmation action; context contains bounded expense/question/option data. This plan keeps operation IDs, concurrency revisions, and authorization evidence application-owned, outside model input/output. Existing evaluator measurements are classification evidence only; no live evaluation or activation is claimed here.

### Source evidence and writer inventory

Verification used graph project `home-nicolasmacenco-NICO-gastto`, full generation `2026-09-12T16:03:19Z`, with Tier 2 task-directed searches and coverage checks. The transition method trace resolves its FSM validator but does not resolve injected callers; source searches therefore supplement the graph. Relevant scope coverage reports no recorded issue, which is not proof of completeness. Re-run the bounded writer inventory before implementation and inspect any newly discovered aliases or persistence paths.

| Path / entry | Observed behavior and required participation |
| --- | --- |
| [TransitionConversationState](../../../src/application/use-cases/conversation/TransitionConversationState.ts), [repository port](../../../src/domain/ports/repositories.ts), [Drizzle repository](../../../src/infrastructure/db/repositories/DrizzleConversationStateRepository.ts) | Validator reads state separately; UPDATE matches only user ID. A transaction around that UPDATE does not reject stale inputs. Every writer needs a revision precondition captured before work. |
| [RegisterExpense](../../../src/application/use-cases/expense/RegisterExpense.ts) | Writes clarification, zero review, ordinary review, and post-save IDLE directly through the repository. Must migrate alongside the transition service. |
| [CorrectExpenseUseCase](../../../src/application/use-cases/expense/CorrectExpenseUseCase.ts), [review resolver](../../../src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase.ts), [action resolver](../../../src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts) | Corrections return new review payloads; the action resolver trusts a supplied payload and starts saving. Capture context before interpretation, commit corrected data conditionally, and claim saving from persisted data. |
| [Message worker](../../../src/interfaces/workers/message.worker.ts) | Owns review presentation, clarification, zero/high-amount paths, undo eligibility, delayed undo, retry dispatch, callback cancellation, and onboarding transitions. Validate bound callbacks before global cancellation or any other action. |
| [AdvancePendingExpense](../../../src/application/use-cases/expense/AdvancePendingExpense.ts), [CancelExpenseRegistrationUseCase](../../../src/application/use-cases/expense/CancelExpenseRegistrationUseCase.ts) | Queue advance interprets/presents before removing the oldest row. Tie consumption to the exact claimed queue item and committed successor; a stale worker must not dequeue another item. |
| [HandleExpiredSessions](../../../src/application/use-cases/conversation/HandleExpiredSessions.ts) | Reads expired snapshots, sends a first reminder and extends review, then cancels/advances on the second expiry. Currently has no shared lock acquisition; stale scan results must not overwrite a correction or save. |
| [HandleOAuthCallback](../../../src/application/use-cases/spreadsheet/HandleOAuthCallback.ts), [InitiateCloudConnection](../../../src/application/use-cases/spreadsheet/InitiateCloudConnection.ts), [SendOAuthReminder](../../../src/application/use-cases/spreadsheet/SendOAuthReminder.ts) | Callback exchanges/persists tokens and announces success before transition. Reminder can replace the OAuth nonce. Bind callback/reminder to the current onboarding nonce and revision, with shared ownership and post-await checks. |
| [RetryExpenseSaveUseCase](../../../src/application/use-cases/expense/RetryExpenseSaveUseCase.ts), [UndoLastExpense](../../../src/application/use-cases/expense/UndoLastExpense.ts), [reconfiguration](../../../src/application/use-cases/spreadsheet/StartSpreadsheetReconfigurationUseCase.ts) | Retry checks supplied expiry but needs an atomic attempt claim; delayed undo needs execution-time expiry and target checks. Recovery cannot overwrite an in-flight effect. |
| [RecoverCorruptedState](../../../src/application/use-cases/conversation/RecoverCorruptedState.ts), [ResolveUserIdentity](../../../src/application/use-cases/user/ResolveUserIdentity.ts) | Direct repository writers must use observed revision or conflict-safe initial creation; recovery must not reset a newer valid state. |
| [Spreadsheet use cases](../../../src/application/use-cases/spreadsheet) | Migrate transition sites in HandleSpreadsheetFileSelection, HandleSheetSelection, ValidateSpreadsheetAccess, InferColumnMapping, ConfirmColumnMapping, CorrectColumnMapping, DetectCategories, ConfirmCategories, ModifyCategoryVocabulary, CancelCloudConnection, and the OAuth/reconfiguration entries above. Nested calls share updated ownership and revision instead of acquiring a second lock. |
| [Incoming DTO](../../../src/application/ports/IncomingMessageJob.ts), [processing DTO](../../../src/application/ports/ProcessMessageJob.ts), [parser](../../../src/infrastructure/adapters/telegram/TelegramPayloadParser.ts), [presenter](../../../src/infrastructure/adapters/telegram/TelegramExpenseSummaryPresenter.ts) | Callback currently carries only action/optional field. Parser currently discards other JSON keys; both queues must preserve validated binding end to end. |
| [Lock port](../../../src/application/ports/UserProcessingLock.ts), [Redis lock](../../../src/infrastructure/redis/RedisUserProcessingLock.ts) | Acquire and token-safe release exist, but renewal does not. Worker uses a three-minute user lease, independently of BullMQ job-lock renewal. |

### Proposed contracts and decisions

#### Persisted concurrency and effect ownership

Add `revision BIGINT NOT NULL DEFAULT 0` to `conversation_states` using Drizzle schema-first generation. Expose it as a canonical unsigned decimal string in `ConversationState` and JSON-facing contracts to avoid JavaScript integer precision loss. Increment on every mutation, including same-state changes, expiry refresh, normalization, and recovery. The user primary key supports conditional updates; do not add a redundant revision-only index.

Replace the unguarded repository mutation with:

```typescript
type StatePrecondition = {
  revision: string;
  currentState: string; // permits exact comparison during corrupted-state recovery
  expiry: 'unexpired' | 'expired' | 'any';
};
type StateWriteResult =
  | { status: 'updated'; state: ConversationState }
  | { status: 'stale' | 'expired' | 'missing' | 'operation_in_progress' };
// IConversationStateRepository
transition(input: {
  userId: string;
  expected: StatePrecondition;
  nextState: FsmState;
  payload: Record<string, unknown> | null;
  expiresAt: Date | null;
  claimId?: string;
}): Promise<StateWriteResult>;
```

The SQL predicate includes user, revision, observed state, and required database-time expiry condition. `unexpired` permits NULL only for non-expiring states; financial confirmations require a non-null future deadline. A stale result has no successor state effects. `TransitionConversationState.execute` requires `expected`, validates the same observed transition, and returns this result. It must not silently fetch a newer revision to authorize an old payload. Initial creation uses insert-on-conflict followed by reload without resetting existing state. Recovery may bypass the FSM validator only for the exactly observed corrupt state/revision.

Retain the Redis per-user lease for admission and add `renew(userId, token, ttlMs): Promise<boolean>` using atomic token comparison. A shared application execution context carries lease ownership, AbortSignal, and the latest persisted snapshot through nested use cases. Renew every 30 seconds with the current 180-second TTL. Renewal failure or uncertain ownership invalidates the context; do not reacquire and continue an old interpretation. Model results arriving afterwards are discarded. A future semantic call must use these same preconditions; no semantic calls are added now.

Redis ownership is not sufficient for financial effects. Before append/delete/retry, atomically consume authorization and persist an application-owned JSONB execution claim `{ claimId, kind, operationId, sourceMessageId, status: 'in_flight' }`, with the immutable authorized target. All competing writers reject replacement while that claim is unresolved, including timeout, OAuth, recovery, and cancellation. Only the matching claim may finalize success/failure. Save uses `EXPENSE_SAVING`; retry and undo may retain their existing state with a claimed substep, without adding an FSM state just for bookkeeping. Repeated delivery sees the claim and does not repeat the external call.

Do not hold a DB transaction open across network work. If lease loss occurs before starting the effect, abort; an already-started network request cannot be undone by cancellation. Preserve its claim and record the confirmed result using claim ownership, or retain an unknown outcome for manual resolution. Neither lease expiry nor process restart automatically releases/replays an unresolved financial claim. Return controlled in-progress/manual-resolution feedback. This prevents competing execution, but does not claim exactly-once delivery across a remote append and a local transaction. Preserve ADR-018's explicit retry warning for uncertain first appends. Local multi-table outcome/audit mutations must be transactional.

OAuth uses the same ownership/preconditions and the nonce currently stored in `ONBOARDING_DRIVE`. Validate before code exchange and again before token/config persistence or advancing the FSM; an expired/replaced callback cannot revive onboarding or send connection-success copy. Perform related local persistence and state mutation atomically where required. Never log the nonce or credentials. Reminder and timeout candidates are reloaded under ownership and conditionally committed; stale candidates produce no obsolete notifications.

#### Review identity and presentation

Extend the canonical review with `reviewBinding: { operationId: string; revision: number; presentedAt: string | null }`. Generate a random 128-bit opaque operation ID encoded as 22 base64url characters. Review revision is a positive safe integer, distinct from the database concurrency revision. New or replacement expense means a new operation ID; an accepted correction, zero/high-amount confirmation stage change, or timeout grace re-presentation advances the review revision. Overflow rotates the operation ID. Queue admission alone does not revise the active review.

Persist the pending binding before rendering. Extend `ExpenseSummaryPresenter.presentSummary(summary, binding): Promise<void>` and `requestHighAmountConfirmation(summary, binding): Promise<void>`; all ordinary, corrected, zero, high-amount, resumed, and queued reviews carry the binding. Mark `presentedAt` only after successful delivery using a conditional write. Failed/uncertain delivery leaves authorization unavailable and permits safe re-presentation. Do not falsely interpret delivery as proof the user read the message.

Normalize legacy JSONB without inventing proof of presentation. A legacy review has no valid binding until it is upgraded, persisted, and re-presented; the triggering affirmative does not save. Preserve hierarchy defaults, correction counters, original text, batch metadata, and nested retry payload continuity. Reject malformed binding fields instead of stripping them during normalization.

Use compact callback wire format `er1:<c|e|x>:<operationId>:<revision-base36>` for confirm/correct/cancel. It fits a 64-byte budget with the bounded ID/revision. The strict normalized DTO is `{ version: 1, action, operationId, reviewRevision }`; reject trailing segments, malformed IDs, invalid/overflow revisions, and unexpected keys. Keep the old JSON action/field shape as an explicitly unbound legacy union for queued jobs and old buttons. Never downgrade malformed versioned input to a valid legacy action.

Validate identity and binding in the application before callback-driven global cancellation, correction, zero/high-amount handling, or save. An old confirm, correct, or cancel button cannot affect the replacement review. Return typed outcomes `handled | stale | expired | unbound | invalid | operation_in_progress`, and use persisted reviewed data rather than trusting a caller-supplied payload. Unbound/stale callbacks produce current-review guidance and a safe current presentation when one exists; they never invoke the old action. Outside review, acknowledge and provide no-active-review guidance.

Whole-message financial command policy uses a dedicated helper so unrelated onboarding matching is unchanged. Trim, lowercase, remove Spanish combining accents, collapse whitespace, and permit only surrounding `¿?¡!.,` punctuation. Compare the entire remaining message to one allowlisted phrase; do not strip arbitrary symbols, quotes, emoji, or internal punctuation. Initial save and delayed undo accept exactly one of `si`, `yes`, `ok`, `dale`, `confirmo`, `correcto`, `listo`, `va`, `barbaro`, `okey`, `perfecto`, `yep`, `sip`, `vale`, `orale`, `ya`. Concatenated affirmatives such as `si ok` are no longer authorization. Retry accepts exactly `reintentar`; immediate undo preserves the existing exact `deshacer`, `undo`, `borrar el ultimo` matcher and eligibility policy. Conditions, negation, quoted commands, arbitrary Unicode removal, and mixed correction text never authorize effects.

Plain text binds to the current successfully presented review under ownership. Require `receivedAt` to be later than `presentedAt`; reject equality conservatively, and do not rebind a queued affirmative after a new presentation. `receivedAt` is a validated channel timestamp, not proof of human attention. Legacy or pre-presentation text gets a fresh prompt. Keep `sí, pero cambia el importe a 25` on the existing correction path; an uninterpretable mixed reply produces clarification without save/delete. Preserve immediate undo for a just-saved expense while its next queued review is active, as implemented, with target checks.

Application-owned copies:

- Stale/unbound with current review: `Ese botón o respuesta corresponde a otro resumen. Revisá el resumen actual y confirmalo de nuevo.`
- Expired review: `Ese resumen expiró. Revisá el nuevo resumen antes de confirmar.`
- No active review: `No hay un gasto pendiente de confirmación.`
- Unresolved operation: `El resultado de esa operación todavía no está confirmado. Revisá la planilla antes de volver a intentarlo.`

At first review expiry, invalidate the old binding, preserve the draft, commit the existing one-time grace period, and present a newly bound summary with the existing queue-aware reminder. Confirmation after expiry but before the sweep follows the same guarded expiry path; it does not revive the old authorization. Second expiry clears only the active draft and advances the exact oldest pending item. Stale clicks never repeatedly extend the deadline. Undo and retry expiry clear only their matching pending context and do not delete/append.

#### Compatibility and rollout boundary

Apply the additive migration before deploying writers that require `revision`. Stop/drain old worker and timeout/reminder processes before new writers handle traffic; mixed old unguarded writers cannot provide the safety guarantee. Preserve queued legacy DTOs using the unbound union. Restart with compatible producers/consumers and re-present active legacy reviews. Rollback retains the additive column; reverting to unsafe writers requires pausing financial processing, not pretending a router flag restores these guarantees. Future semantic-mode rollback must retain this safety layer.

The migration is necessary for a durable version across NULL JSONB and every state writer, not for future reserved fields. [Drizzle configuration](../../../drizzle.config.ts) currently generates under `src/infrastructure/db/migrations`; follow that configured path, do not hand-write or alter applied migrations. Local migration verification uses disposable test databases; ask the user to run credential-dependent local migration commands if needed, without reading secret files.

## Phases

### Phase 1: Guard state writers and demonstrate stale-context rejection

#### Description

Deliver a runnable concurrency slice: delayed correction/timeout/OAuth work cannot replace a newer state, and financial execution cannot be replayed merely because a user lease expires. Complete the common ownership contract across all writers in this delivery; do not ship a partially guarded writer set.

#### To-do actions

- [x] Revalidate the writer inventory, including all repository transition aliases, queue consumers, bootstrap composition, creation, corruption recovery, and onboarding entry points; read relevant source beyond graph gaps.
- [x] Add the schema revision, domain mapping, required repository preconditions/results, and shared execution context described above; migrate all writers and test doubles in one buildable change. Remove the unguarded mutation signature.
- [x] Generate the additive migration using `pnpm db:generate`; verify both a fresh database and an upgrade preserving existing JSONB/NULL states through disposable PostgreSQL integration tests. Record any user-run local migration still pending.
- [x] Extend Redis renewal and shared entry-point ownership for processing, timeout, OAuth callback/reminder, recovery, and onboarding. Preserve contention-only BullMQ retries; propagate cancellation and updated revisions through nested calls.
- [x] Add persistent financial claims and claim-guarded finalization for existing save, undo, and retry entry points. Reserve authorization before external effects, reject competing writers, and preserve uncertain in-flight outcomes without automatic replay.
- [x] Make timeout notifications conditional on a successful transition, protect OAuth nonce/token/state changes, and tie queue advancement/removal to the exact source item and committed successor using a transactional local handoff where needed.
- [x] Add `conversation-state-concurrency.integration.spec.ts` using real PostgreSQL and Redis with controlled boundary promises: same-state ABA replacement, competing corrections, stale timeout scan, OAuth nonce rotation, corruption reset race, initial creation conflict, lease expiry while interpretation waits, old-token renewal/release, duplicate financial claims, and effect completion after lease loss. Assert stale workers do not overwrite state, dequeue another expense, append, or delete.
- [x] Update conversation-state and cloud-connection feature docs, affected save/undo docs, feature index, FSM/data-model docs, and record the concurrency/claim trade-off in a dated ADR plus ADR index. Document unresolved-claim recovery and coordinated writer rollout.
- [x] Run `pnpm test`, including the required database/Redis integration suite; a skipped integration suite is pending evidence, not a passed concurrency gate.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

#### Completion evidence (2026-09-13)

- The bounded writer audit found three direct production callers of `IConversationStateRepository.transition`: `ResolveUserIdentity`, `RecoverCorruptedState`, and `TransitionConversationState`. All pass an observed revision/state precondition. The two production `RegisterExpense.save` callers pass a claim ID, and the production queue consumer passes the expected queue item ID.
- `conversation-state-concurrency.integration.spec.ts` ran against disposable PostgreSQL and Redis containers: 8 tests passed. Fresh migration/default and legacy NULL/JSONB upgrade behavior, stale state races, token-safe renewal/release, exact queue successor removal, zero stale boundary effects, and claim ownership/finalization passed. No migration was applied to a user-configured local database; that environment-specific rollout remains a user-run deployment step.
- The first real run exposed a claim-guard defect that mocks had missed. Claim ownership is now validated from the persisted snapshot before the revision/state/expiry CAS update; a concurrent claim change increments revision and invalidates the writer. The repository unit suite passed 11 tests after this correction.
- The complete suite ran outside the filesystem/network sandbox with one worker to avoid testcontainer/bootstrap contention: 139 files and 1,867 tests passed; 4 unrelated conditionally disabled suites and 29 tests remained skipped. The required PostgreSQL/Redis concurrency suite was not skipped. Bootstrap passed 10 tests, and the existing PostgreSQL conversation-state and spreadsheet-access suites passed 16 tests after their harnesses propagated the production ALS context.
- Direct project binaries were used because `pnpm` fails in this environment with `unable to open database file`: `eslint .` and `tsc --noEmit` passed. ESLint emitted only the existing module-type performance warning.
- Codebase Memory generation `2026-09-13T10:13:34Z` checked all 67 modified paths. The only modified partial file was the concurrency suite at lines 67 and 96; both ranges were read directly. `.codebase-memory` artifacts remain excluded by design.

### Phase 2: Bind the complete review interaction to its presented version

#### Description

Deliver the user-visible corrected-summary regression end to end: an old button cannot save or cancel the corrected/replacement expense, while a new explicit confirmation saves the displayed amount once.

#### To-do actions

- [ ] Implement validated review binding, legacy normalization, and conditional presentation completion in review creation, clarification completion, correction, zero/high-amount steps, queue advance, and re-presentation paths.
- [ ] Implement the compact callback codec and strict bound/legacy DTO union through Telegram parser, normalized payload, incoming queue, RouteIncomingMessage, processing queue, worker, presenter, and application resolver. Validate before global callback cancellation; preserve identity checks, deduplication, and acknowledgments.
- [ ] Extend action/reply resolver inputs with the captured state precondition and deterministic authorization evidence; return explicit stale/expired/unbound/invalid/in-progress outcomes and load the authorized payload from persistence.
- [ ] Implement the exact financial command policy above and reject pre-presentation queued text using captured channel time. Keep mixed affirmative/correction messages in contextual correction without adding model-based authorization.
- [ ] Implement the two-stage expiration policy with a new review binding during grace, safe legacy re-presentation, no stale-click TTL refresh, and the application-owned guidance copies.
- [ ] Extend parser/DTO/presenter/resolver/worker tests and add `expense-confirmation-context.e2e.spec.ts`: original 30 EUR review, correction to 35 EUR, old confirm/cancel/correct all rejected, new confirm appends 35 once; same-state replacement; duplicate delivery with distinct callbacks; forged identity; malformed/versioned/legacy callbacks; legacy JSONB; expired before sweep; grace then second expiry; queued affirmatives; failed presentation; zero/high-amount stage replay; queue overflow leaves binding and draft intact.
- [ ] Test command normalization as public policy with all exact vocabulary and negative examples `sí, pero cambia el importe a 25`, `no confirmo`, `si ok`, quoted `"si"`, emoji-decorated commands, internal punctuation, conditions, and prompt injection. Assert zero append/delete for rejected authorization and no loss of the original text.
- [ ] Update confirmation, correction, summary-review, incoming-routing, cancellation, and state-management docs plus feature index and FSM payload documentation with implemented contracts and compatibility.
- [ ] Run `pnpm test` including the complete callback-to-application regression with real core policy and mocked messaging/LLM/spreadsheet boundaries.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Close undo/retry context gaps and verify the prerequisite

#### Description

Deliver expired/replaced undo and retry rejection with the same ownership guarantees, and produce cross-flow evidence required before planning semantic shadow integration.

#### To-do actions

- [ ] Bind delayed undo presentation to its offered latest record, successful presentation timestamp, revision, and non-null expiry. Recheck the latest non-deleted record under the claimed execution before external deletion; preserve external-delete-before-local-success/audit ordering.
- [ ] Preserve deterministic one-message immediate undo, including queued-review eligibility consumption, and prevent unrelated or stale callbacks from being converted into deletion authorization. No inferred undo execution is added.
- [ ] Bind the exact retry command to the persisted confirmed expense and ten-minute window, atomically consume its single available reattempt, and preserve terminal manual fallback, transparent OAuth refresh limits, and reconfiguration policy. Legacy valid retry/undo context must be re-presented before accepting newly bound authorization if presentation cannot be established.
- [ ] Add `financial-action-context.integration.spec.ts`: delayed undo at/after expiry before sweep; latest record replaced; immediate eligibility consumed once; concurrent confirms; duplicate retry; retry expiry; first append timeout followed by one explicit retry; second failure terminal; process restart with an unresolved claim; OAuth/timeout attempts during append/delete; local finalization failure after remote success. Assert no unauthorized external call, no second automatic call, and no false success/audit or overwrite of successor state.
- [ ] Add a deferred-promise context-validation test representing a future model request: return after revision change or lease loss, reject the proposal, and assert zero state/queue/message/financial effects from it. Use no live provider or semantic dispatch integration.
- [ ] Run existing evaluator offline regressions without modifying frozen labels merely to fit new behavior. If deterministic-policy reports change, version the policy/report evidence and explain the whole-message change separately from model accuracy; retain Phase 1 live-evaluation limitations.
- [ ] Update undo, confirmation/retry, state-management and relevant evaluation docs, feature indexes, FSM payloads, and the concurrency ADR/index as applicable. Record coordinated deployment and safe rollback checks with queued legacy jobs and unresolved claims.
- [ ] Run `pnpm test` and required PostgreSQL/Redis suites; attach scenario counts, zero false-authorization/unauthorized-effect observations, and remaining external verification to this plan and the master's implementation table. Do not mark master Phase 2 implemented until all three deliveries and migration verification are complete.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Review the verified Phase 1 changes, then explicitly request implementation of Phase 2 when ready.
