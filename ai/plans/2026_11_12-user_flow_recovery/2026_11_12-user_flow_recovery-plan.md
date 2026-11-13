# User Flow Recovery

## Goal

Address the six user-flow findings from the read-only review, with one independently reviewable phase per finding. Users should receive an actionable continuation or safe exit while financial operations retain their authorization, ownership, and duplicate-prevention guarantees.

## Context

The user approved these six phases and their behavioral contracts and explicitly requested execution. Implementation proceeds one current phase at a time under the execute-plan skill. Findings come from static source inspection and existing test review, not live Telegram or Google reproductions. Each phase must first reproduce its reported scenario with a focused regression test.

Repository paths below are relative to this plan directory.

### Architecture and conventions

- [AGENTS.md](../../../AGENTS.md): Clean Architecture boundaries, documentation synchronization, secret restrictions, and ship checks.
- [Plan conventions](../../../docs/plans/plan-conventions.md): vertical slices and required phase completion tasks.
- [ADR index and decisions](../../../docs/adr/adr.md): persisted FSM, spreadsheet adapters, asynchronous processing, financial confirmation, and OAuth lifecycle.
- [Testing guidelines](../../../docs/testing/guidelines.md): FSM coverage, boundary-only mocks, negative financial assertions, and PostgreSQL/Redis integration.
- [Data model](../../../docs/architecture/data-model.md): conversation revisions, configuration history, expense queue, and operation persistence.
- [Conversation state management](../../../docs/features/conversation-state-management.md): guarded transitions, cancellation, expiry, execution ownership, and financial claims.
- [Incoming message routing](../../../docs/features/incoming-message-routing.md): admission, worker locking, bounded retries, and deterministic command routing.

### Relevant implementation and feature contracts

- [UndoLastExpense](../../../src/application/use-cases/expense/UndoLastExpense.ts) and [undo feature](../../../docs/features/undo-last-expense.md): a persisted claim precedes local reads currently outside the protected error-handling region.
- [Message worker](../../../src/interfaces/workers/message.worker.ts), [FSM transitions](../../../src/domain/entities/ConversationState.ts), and [Telegram access approval](../../../docs/features/telegram-access-approval.md): OAuth admission can intercept cancellation and request an invalid transition from a pending authorization state.
- [HandleSpreadsheetFileSelection](../../../src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts) and [file selection feature](../../../docs/features/select-spreadsheet-file.md): empty-list and active-search branches precede direct-link handling.
- [RetryExpenseSaveUseCase](../../../src/application/use-cases/expense/RetryExpenseSaveUseCase.ts), [ResolveExpenseSummaryActionUseCase](../../../src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts), [AdvancePendingExpense](../../../src/application/use-cases/expense/AdvancePendingExpense.ts), and [expense confirmation](../../../docs/features/expense-confirmation.md): retry success does not invoke the normal pending-expense continuation.
- [SendOAuthReminder](../../../src/application/use-cases/spreadsheet/SendOAuthReminder.ts), [HandleOAuthCallback](../../../src/application/use-cases/spreadsheet/HandleOAuthCallback.ts), [HandleSheetSelection](../../../src/application/use-cases/spreadsheet/HandleSheetSelection.ts), and [cloud connection](../../../docs/features/cloud-storage-connection.md): reminder payload replacement loses reauthorization intent; subsequent guidance can direct users to a command unavailable in their current state.
- [RouteIncomingMessage](../../../src/application/use-cases/conversation/RouteIncomingMessage.ts) and [dependency wiring](../../../src/bootstrap/buildDependencies.ts): messages are marked admitted before processing; bounded lock contention can end in a permanent worker failure with logs only.
- [Chat spreadsheet settings](../../../docs/features/chat-spreadsheet-settings.md) and [sheet selection](../../../docs/features/select-sheet.md): safe destination changes and navigation from onboarding.
- [Feature index](../../../docs/features/README.md): update whenever a feature document changes. Update [ADR index](../../../docs/adr/README.md) if an architectural decision is added or changed.

### Shared constraints

- Keep business decisions in Application use cases and use the existing ports for messaging, persistence, and provider calls.
- Preserve revision comparisons, current ownership, action bindings, and the prohibition on replaying uncertain spreadsheet effects.
- A known failure before any remote effect may be recovered safely. An ambiguous remote result must remain protected; never clear existing unknown claims simply because they are old or the user requests cancellation.
- Recovery of already persisted ambiguous claims and live production data repair are outside this plan.
- Use real application/domain behavior in regression scenarios and mock external boundaries. Use isolated PostgreSQL/Redis integration where claim, revision, or job behavior requires it; never read deployment secrets or use production data.
- Include meaningful tests and canonical documentation in every phase. Keep each phase buildable and independently reviewable.

## Phases

### Phase 1: Recover undo failures before the remote deletion

**Description:** Prevent a transient database failure during undo preparation from leaving the user permanently blocked by a claim when no Google deletion has begun.

**Public contracts:**

- `UndoLastExpenseUseCase.execute` must handle failures in post-claim local reads and finalize only its own claim when it can prove that no remote effect started. Preserve its existing authorization requirements and typed outcomes where possible.
- User-facing undo failure copy must distinguish a recoverable pre-effect failure from an uncertain financial result. The former allows another request through normal authorization; the latter must not promise that a simple retry is available.
- Extend the undo application suite and financial-action integration coverage with pre-effect failure and ownership scenarios.

**Acceptance criteria:** With persistence available for cleanup, either post-claim read may fail without invoking `deleteRow`, leaving a claim that blocks future chat, or reporting a successful deletion. An ownership race must preserve the newer state. If cleanup persistence also fails, retain protection and report/log the unresolved condition rather than claiming recovery.

**To-do actions:**

- [x] Reproduce failure of the latest-expense reread and historical-configuration read after claim acquisition.
- [x] Include the entire post-claim preparation in explicit error handling and track whether a remote effect could have begun.
- [x] Finalize known pre-effect failures with the matching claim only; ensure failure logging cannot prevent an otherwise possible safe cleanup.
- [x] Preserve unknown-outcome protection after a provider ambiguity or local persistence failure following a successful deletion.
- [x] Update user-facing copy and verify that a later undo request uses normal confirmation rules rather than silently reusing consumed authorization.
- [x] Test both database read failures, cleanup failure, stale ownership, zero remote calls before failure, uncertain deletion, and absence of duplicate deletion or false success.
- [x] Update `undo-last-expense.md`, the relevant claim recovery behavior in `conversation-state-management.md`, and `docs/features/README.md`.
- [x] Run the focused regression and relevant isolated integration suites, then `pnpm test`; resolve failures attributable to this phase.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Validation evidence (2026-11-13):**

- Both new pre-effect read regression cases fail against the original undo implementation and pass with the recovery change.
- Focused undo and worker lifecycle suites: 33 passing tests before the final test-callback lint adjustment.
- Final worker lifecycle and PostgreSQL/Redis financial-action suites: 23 passing tests, including durable cleanup after both read failures and rejection of consumed confirmation.
- `DOTENV_CONFIG_PATH=/dev/null pnpm test`: 195 suites passed, 9 skipped; 2,665 tests passed, 45 skipped. The final callback-only lint adjustment was verified in the focused rerun.
- `pnpm run lint` and `pnpm run typecheck` passed. Formatting and `git diff --check` passed. The unnecessary async test callback reported by the initial lint run was corrected and the complete lint command rerun successfully.
- Existing unresolved claims remain protected and require manual investigation. No production data repair or provider replay was performed.

### Phase 2: Make OAuth cancellation and continuation reachable

**Description:** Remove the admission loop that intercepts `cancelar` and attempts an invalid `ONBOARDING_DRIVE` to `ONBOARDING_START` transition when the approved user lacks usable Google credentials.

**Public contracts:**

- `processMessageJob` must allow safe explicit cancellation to reach the existing guarded cancellation use case before missing-credential admission rejects the turn.
- Exact `continuar` must start authorization from a supported initial state or resume/renew pending authorization through a valid state-aware path. It must not bypass access approval or initiate a financial effect.
- Cancellation and continuation copy must describe actions supported by the actual state, including pending authorization and credential loss during another flow.
- Extend worker, OAuth, and cancellation suites with access approval enabled and real FSM transition validation.

**Acceptance criteria:** An approved user waiting for Google can cancel to `IDLE` or obtain a usable authorization link without an invalid transition. A cancelled flow cannot be revived by an old callback. Financial claims remain protected even when credentials are missing.

**To-do actions:**

- [x] Reproduce the approval-enabled sequence: `continuar`, pending or denied OAuth, `cancelar`, and repeated `continuar`.
- [x] Define admission precedence for identity/access checks, financial-claim protection, safe cancellation, and state-aware OAuth continuation; implement business recovery through Application use cases.
- [x] Reuse guarded cancellation and nonce/reminder cleanup. Keep callbacks bound to the current flow and revision.
- [x] Handle credential loss in other active states with an explicit valid continuation or safe-exit instruction, without clearing drafts or claims implicitly to force a transition.
- [x] Test denied and expired authorization, repeated continuation, cancellation without credentials, stale callbacks, existing claims, and unchanged rejection of unapproved access.
- [x] Update `telegram-access-approval.md`, `cloud-storage-connection.md`, `incoming-message-routing.md`, any changed cancellation/state contract, and `docs/features/README.md`.
- [x] Run the focused regression and relevant isolated integration suites, then `pnpm test`; resolve failures attributable to this phase.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Validation evidence (2026-11-13):**

- The new approved-user cancellation and pending-link renewal worker regressions failed against the original admission branch and passed after the change.
- Focused worker, OAuth initiation/callback, and guarded cancellation suites: 314 tests passed.
- Full suite with container and local-listener access: 195 suites passed, 9 skipped; 2,670 tests passed, 45 skipped. The sandbox-only run had failed solely on container-runtime discovery and local-listener permission; both affected suites passed with the required access.
- Typecheck, source lint, formatting, and `git diff --check` passed using local binaries. The installed `pnpm` launcher could not open its own database in this environment, so the matching package scripts were run through their `node_modules/.bin` executables.
- Existing `.codebase-memory` changes were present before this phase and were left untouched.

### Phase 3: Recover file discovery from empty lists and active searches

**Description:** Ensure file names and supported direct links remain usable when the initial list is empty or a search has no results.

**Public contracts:**

- `HandleSpreadsheetFileSelection.execute` must recognize supported direct links before treating a turn as a search query or an initial-list request.
- Empty-list responses must persist a search-capable state so that the next name is actually searched. Existing revision-bound numeric selections must continue to refer only to their displayed list.
- File-selection copy must offer executable name-search, supported-link, and cancellation choices.
- Extend file-selection and routing tests to cover empty and searching payloads, including enabled semantic routing compatibility.

**Acceptance criteria:** Empty list followed by a name searches by that name; an empty list or unsuccessful search followed by a valid link validates that file and continues to sheet selection. Access denial preserves a usable selection flow.

**To-do actions:**

- [x] Reproduce initial-empty-list and search-without-results loops, including pasting a link in each state.
- [x] Order deterministic parsing so global cancellation remains available and supported URLs precede name-search and initial-list fallback.
- [x] Persist the appropriate search substep after an empty result and keep provider and relevant flow metadata intact.
- [x] Preserve file access validation, guarded transitions, displayed-list binding, and eager sheet discovery.
- [x] Align prompts with supported input and ensure invalid or unsupported URLs do not select an arbitrary file.
- [x] Test name search after an empty list, links in both states, repeated empty results, denied access, stale selection, cancellation, and deterministic dispatch with semantic routing enabled.
- [x] Update `select-spreadsheet-file.md`, any affected routing contract, and `docs/features/README.md`.
- [x] Run the focused regression and relevant isolated integration suites, then `pnpm test`; resolve failures attributable to this phase.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Validation evidence (2026-11-13):**

- Four focused empty-list and Sheets-link regressions failed against the original implementation and passed after the file-selection change.
- Focused file selection, routing, and copy suites passed after the final stale-list ordering change.
- Full suite with container and local-listener access: 195 suites passed, 9 skipped; 2,683 tests passed, 45 skipped.
- Source lint, typecheck, formatting, and `git diff --check` passed using the local executables because the installed `pnpm` launcher could not open its database in this environment.

### Phase 4: Resume the pending-expense queue after successful retry

**Description:** Make successful user-authorized retry continue the expense batch through the same FIFO behavior used by ordinary confirmation.

**Public contracts:**

- Extend `RetryExpenseSaveInput` with `channel: 'telegram' | 'whatsapp'` and update its callers. Add the existing pending-expense advancement service to its dependencies and production wiring.
- After confirmed save success, preserve `queueRegisteredCount` and the saved expense reference for immediate undo when calling `AdvancePendingExpense.execute` with `reason: 'confirmed'`.
- Success feedback must precede the next pending review and the existing closing summary must remain correct. A subsequent delivery or queue-advancement failure must not be classified as a failed append or trigger a second append.
- Extend retry, worker, and expense lifecycle tests to cover multi-item continuation and post-save failures.

**Acceptance criteria:** Given A in retry and B pending, one valid retry saves A once and presents B through the normal flow. An empty queue ends the batch correctly. Duplicate or stale authorization cannot repeat the save or consume another queued item.

**To-do actions:**

- [x] Reproduce A in review, B queued, recoverable save failure for A, and successful retry leaving B unpresented.
- [x] Add channel propagation and the advancement dependency across the use case, worker caller, bootstrap, and affected fixtures.
- [x] Separate financial save error handling from successful-save messaging and continuation so downstream failures cannot enter the retry-failure branch.
- [x] Reuse FIFO advancement with the incremented completion count and saved expense ID; preserve exact-item removal and existing authorization-loss behavior.
- [x] Preserve successful-save messaging, batch closing feedback, and immediate-undo context consistently with ordinary confirmation.
- [x] Test pending and empty queues, batch counts, repeated authorization, correct channel, failed next-review presentation, and zero duplicate appends or inappropriate manual-copy fallback after success.
- [x] Update `expense-confirmation.md`, any changed queue behavior in `conversation-state-management.md`, and `docs/features/README.md`.
- [x] Run the focused regression and relevant isolated integration suites, then `pnpm test`; resolve failures attributable to this phase.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Validation evidence (2026-11-13):**

- The successful-retry continuation regression failed against the original use case and passed after the queue handoff was added.
- Focused retry, worker, queue, confirmation, and expense lifecycle suites: 289 tests passed. The PostgreSQL/Redis semantic retry integration suite passed 7 tests.
- Full suite with container and local-listener access: 195 suites passed, 9 skipped; 2,688 tests passed, 45 skipped.
- Source lint, typecheck, formatting, and `git diff --check` passed using local executables.

### Phase 5: Preserve reconnection intent across reminders

**Description:** Keep a configured user's reconnection flow from becoming a fresh destination-selection flow after the OAuth reminder, and remove contradictory navigation guidance.

**Public contracts:**

- `SendOAuthReminder.execute` must preserve validated reconnection metadata, including `reauthorizationOnly`, while rotating the nonce under the current revision.
- `HandleOAuthCallback.execute` must continue reusing a completed destination after a reminder when reconnection eligibility still holds.
- When onboarding refuses to replace an existing configured destination, the user-facing instruction must specify the supported sequence: cancel the current flow, open `configuración`, and select the destination-change option.
- Extend reminder, callback, sheet-selection, and worker tests for delayed reconnection and the complete navigation sequence.

**Acceptance criteria:** A configured user completes OAuth using the reminder link and retains the existing destination and mappings. If the user reaches a destination-conflict branch, following the displayed instructions reaches settings successfully.

**To-do actions:**

- [ ] Reproduce reconnection with `reauthorizationOnly: true`, reminder execution, and callback behavior after payload replacement.
- [ ] Preserve the validated context required for reconnection while replacing nonce-specific fields; avoid copying obsolete authorization metadata blindly.
- [ ] Verify nonce/revision binding rejects old links and reminders cannot revive a cancelled or completed flow.
- [ ] Update conflicting sheet-selection guidance to include cancellation before opening settings, preserving configuration history protections.
- [ ] Test reminder-based configuration reuse, initial onboarding without a configured destination, old nonce rejection, cancellation races, and the complete cancel-to-settings sequence.
- [ ] Update `cloud-storage-connection.md`, `select-sheet.md`, any affected settings guidance, and `docs/features/README.md`.
- [ ] Run the focused regression and relevant isolated integration suites, then `pnpm test`; resolve failures attributable to this phase.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 6: Notify users when lock-contention retries are exhausted

**Description:** Replace silent permanent failure for a message that never acquired the per-user processing lock with bounded, actionable feedback. Retain the existing finite retry policy.

**Public contracts:**

- Add an Application notification service, proposed as `NotifyMessageProcessingContention.execute({ channel, externalId, externalMessageId })`, invoked for a validated message whose final failure is specifically lock contention before handler execution.
- Proposed user-facing copy: `No pude procesar este mensaje porque todavía estaba terminando el anterior. Cuando termine, volvé a enviar el mensaje que quedó pendiente.` Keep this copy in the application copy module and do not quote financial input or expose provider details.
- Worker failure handling must distinguish intermediate retries from final exhaustion and must not apply the safe-resend wording to arbitrary errors or uncertain financial operations.
- Extend worker/service tests and isolated Redis/BullMQ integration to validate the application's final-failure classification and notification behavior.

**Acceptance criteria:** Final contention exhaustion produces one notification attempt for that final handling path and no financial effect for the unprocessed message. Intermediate contention produces no failure notice. Notification failure is logged and does not replay the expense job. Delivery is best effort, not a promise of guaranteed receipt during a messaging outage.

**To-do actions:**

- [ ] Reproduce final lock-contention exhaustion while another message retains the user's processing lease.
- [ ] Implement the Application notification service using the existing messaging port and structured logger, and wire it through worker dependencies.
- [ ] Trigger notification only after confirming final contention exhaustion for validated job data; retain identity checks and avoid treating generic pre-handler or provider failures as safe resend cases.
- [ ] Handle asynchronous notification errors explicitly so the failed-event path cannot create an unhandled rejection or rerun a side-effectful job.
- [ ] Keep existing bounded retry timings and ensure notification does not require the same user lock that caused the exhaustion.
- [ ] Test final exhaustion, recovery before exhaustion, intermediate failures, unrelated errors, invalid job data, channel routing, and messaging rejection without state mutation or financial replay.
- [ ] Update `incoming-message-routing.md`, relevant delivery documentation, and `docs/features/README.md`.
- [ ] Run the focused regression and relevant isolated integration suites, then `pnpm test`; resolve failures attributable to this phase and verify the six user journeys together.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

After the Phase 4 review/commit decision, begin Phase 5 by reproducing loss of reconnection intent after the OAuth reminder.
