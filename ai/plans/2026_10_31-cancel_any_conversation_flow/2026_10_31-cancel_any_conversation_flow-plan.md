# Cancel Any Conversation Flow Safely

## Goal

Let users leave every cancellable conversation state with an explicit command, including the onboarding `no-header` loop, and receive a clear way to resume setup. Preserve revision ownership, existing expense queue behavior, and financial execution claims.

## Context

- [AGENTS.md](../../../AGENTS.md) defines the documentation, testing, database, and financial safety gates.
- [Plan conventions](../../../docs/plans/plan-conventions.md) define the required vertical slices and review points.
- [ADR-003](../../../docs/adr/ADR-003-fsm-postgresql.md), [ADR-014](../../../docs/adr/ADR-014-fsm-eager-advance.md), and [ADR-024](../../../docs/adr/ADR-024-guard-conversation-writes-and-financial-effects.md) define the persisted FSM, eager onboarding transitions, guarded writes, and execution claims.
- [Conversation state management](../../../docs/features/conversation-state-management.md), [expense cancellation](../../../docs/features/expense-cancellation.md), [incoming message routing](../../../docs/features/incoming-message-routing.md), and [chat spreadsheet settings](../../../docs/features/chat-spreadsheet-settings.md) define current command behavior.
- [Select sheet](../../../docs/features/select-sheet.md), [validate spreadsheet access](../../../docs/features/validate-spreadsheet-access.md), and [infer column mapping](../../../docs/features/infer-and-propose-column-mapping.md) define the empty-sheet and no-header paths.
- [FSM transitions](../../../src/domain/entities/ConversationState.ts), [message worker](../../../src/interfaces/workers/message.worker.ts), [intent utilities](../../../src/application/utils/intents.ts), [deterministic routing](../../../src/application/services/semantic-router/deterministic-routing.ts), and [guarded transitions](../../../src/application/use-cases/conversation/TransitionConversationState.ts) are the main implementation points.
- [Cloud connection cancellation](../../../src/application/use-cases/spreadsheet/CancelCloudConnection.ts), [expense cancellation](../../../src/application/use-cases/expense/CancelExpenseRegistrationUseCase.ts), [sheet selection](../../../src/application/use-cases/spreadsheet/HandleSheetSelection.ts), [access validation](../../../src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts), and [mapping inference](../../../src/application/use-cases/spreadsheet/InferColumnMapping.ts) own flow-specific cleanup and prompts.
- Current failure: `cancelar` in `ONBOARDING_MAPPING` with `step: 'no-header'` is parsed as an invalid row and self-transitions back to the same state. `configuración` is rejected while onboarding remains active. A sheet is persisted as an initial configuration before mapping confirmation, so cancellation must avoid treating that incomplete destination as ready for expenses or settings.

## Approved behavior and public contracts

- Explicit text commands `cancelar`, `salir`, `cancel`, and `exit` request cancellation from any active conversational flow, regardless of case and surrounding whitespace. The existing documented expense aliases remain supported in expense states. `no` keeps its context-specific meaning, including mapping rejection and negative answers, and is not a new global escape command.
- Existing Telegram `Cancelar` review callbacks remain bound to the successfully presented expense review. A stale or forged callback cannot cancel a different flow. Do not add an unbound generic callback.
- A successful cancellation clears the owned FSM payload and expiry through a revision-guarded transition before sending a flow-specific response. Expense cancellation continues to use `CancelExpenseRegistrationUseCase` so pending expenses advance exactly as today. OAuth and settings cleanup retain their existing ownership checks.
- Introduce an application-level `CancelConversationFlow` entry point for non-expense flows, with a typed input containing `userId`, the observed `ConversationState`, messaging identity, and explicit command source, and a result that distinguishes cancellation, no active flow, and financial operation in progress. Keep the exact method signature local to the implementation review while preserving these required fields and outcomes.
- For incomplete onboarding, the cancellation reply tells the user how to restart setup; for a fully configured destination, it may also offer `configuración`. A canceled initial setup must not make an incomplete spreadsheet usable. Do not silently switch to the settings menu during cancellation.
- An active `executionClaim` remains authoritative. A cancel request cannot clear a claimed state or imply that a spreadsheet append/delete was rolled back; send a bounded waiting or manual-resolution response instead.
- No new HTTP route, BullMQ job shape, database table, or migration is planned. Revisit this only if implementation evidence shows an unavoidable contract change.

## Phases

### Phase 1: Escape every onboarding step

Description: Deliver the visible fix for the reported no-header loop and the other onboarding states without changing expense behavior.

- [x] Add `CancelConversationFlow` for onboarding with revision-guarded transition to `IDLE`, payload/expiry cleanup, and flow-specific response. Reuse `CancelCloudConnection` cleanup for `ONBOARDING_DRIVE` and clear only proposal-bound transient mapping correction state where applicable. Preserve incomplete spreadsheet records without activating them.
- [x] Route explicit cancellation before onboarding substep parsers, inference, file/sheet selection, and eager validation in [message.worker.ts](../../../src/interfaces/workers/message.worker.ts). Keep `no` as a contextual mapping response. Ensure a late OAuth callback or eager continuation cannot restore the canceled revision.
- [x] Update [onboarding copies](../../../src/application/copies/onboarding.copies.ts) with cancellation and restart guidance. If a completed destination exists, mention `configuración`; otherwise guide the user to restart onboarding. Make `no-header` and invalid-row prompts show the explicit escape command.
- [x] Add meaningful worker/use-case tests for each onboarding state, especially `ONBOARDING_MAPPING/no-header`, `resume`, and proposal review; assert state cleanup before response, no inference after cancellation, stale revision rejection, OAuth cleanup, and preserved incomplete configuration safety.
- [x] Update [conversation state management](../../../docs/features/conversation-state-management.md), [infer column mapping](../../../docs/features/infer-and-propose-column-mapping.md), relevant onboarding feature docs, and [features index](../../../docs/features/README.md). Update an ADR and [ADR index](../../../docs/adr/README.md) only if a new architectural decision is required.
- [x] Run `pnpm test` for the affected suites and fix failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Complete cancellation across non-onboarding states

Description: Apply the approved command contract consistently to settings, undo, and failed-save retry while preserving expense-specific authorization and queue handling.

- [x] Inventory every `FsmState` against the worker routes and mark each as cancellable, already idle, or blocked by an active financial claim. Keep callback cancellation bound to its current expense review and ensure typed text cancellation reaches the deterministic FSM path before optional semantic dispatch.
- [x] Route explicit cancellation for `EXPENSE_SAVING_RETRY` and other uncovered user-facing states to the guarded non-expense cancellation entry point. Preserve `CancelExpenseRegistrationUseCase` for active drafts and its FIFO queue advancement. For `EXPENSE_SAVING`, reject state clearing while an execution claim is unresolved and provide the approved bounded response.
- [x] Ensure settings draft, destination candidate, and OAuth cancellation use their existing cleanup/commit boundaries; a canceled draft must not change the active destination, vocabulary, or credentials.
- [x] Add worker and use-case tests for retry cancellation, undo confirmation, settings states, `IDLE`, existing review callbacks, semantic bypass, stale revisions, and claimed financial states. Assert that no append/delete, retry, queue advancement, or destination activation occurs from an unauthorized cancel.
- [x] Update [expense cancellation](../../../docs/features/expense-cancellation.md), [incoming message routing](../../../docs/features/incoming-message-routing.md), [chat spreadsheet settings](../../../docs/features/chat-spreadsheet-settings.md), [conversation state management](../../../docs/features/conversation-state-management.md), and [features index](../../../docs/features/README.md) for the delivered command behavior.
- [x] Run `pnpm test` for affected suites and fix failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Make empty-sheet and no-header recovery clear

Description: Distinguish an actually empty or effectively blank preview from a nonempty sheet with unrecognized headers, and guide the user to a recoverable choice.

- [x] Add a shared, testable classification at the spreadsheet access/mapping boundary for previews with no meaningful cell values, including provider responses that contain row objects with only empty cells. Return to sheet selection for those previews instead of asking for a data-start row that cannot exist.
- [x] Keep the `no-header` question only for a nonempty preview where a header row might exist. State how to choose another sheet or cancel; do not imply that a header can always be manufactured by entering a number.
- [x] Add adapter or application boundary tests for zero rows, blank row objects, title-only rows, data without headers, and valid later headers. Add a worker regression test for the exact transcript: `no tiene`, `configuración`, `cancelar`; the final command must leave the loop and allow a fresh setup path.
- [x] Update [validate spreadsheet access](../../../docs/features/validate-spreadsheet-access.md), [select sheet](../../../docs/features/select-sheet.md), [infer column mapping](../../../docs/features/infer-and-propose-column-mapping.md), and [features index](../../../docs/features/README.md). Update architecture or ADR documentation and indexes if classification boundaries change materially.
- [x] Run `pnpm test` for affected suites, then the full `pnpm test` ship gate; fix failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Review the completed plan and optionally commit the changes.
