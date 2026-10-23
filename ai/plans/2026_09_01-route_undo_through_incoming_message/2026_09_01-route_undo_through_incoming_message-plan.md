# Route Undo Through Incoming Message Filtering

## Goal

Ensure every supported undo command bypasses non-financial guidance at the incoming-message router and reaches the FSM worker, allowing immediate and delayed undo behavior to execute as documented.

## Context

- [`src/application/use-cases/conversation/RouteIncomingMessage.ts`](../../../src/application/use-cases/conversation/RouteIncomingMessage.ts): The thin-worker router currently classifies undo commands as non-financial text and returns after sending guidance instead of enqueueing them for FSM processing.
- [`src/application/utils/intents.ts`](../../../src/application/utils/intents.ts): Shared conversational intent utilities. This is the canonical location for the new reusable `isUndoIntent(rawMessage: string): boolean` contract.
- [`src/interfaces/workers/message.worker.ts`](../../../src/interfaces/workers/message.worker.ts): The thick FSM worker currently owns a private undo-command detector that must be replaced by the shared intent utility.
- [`src/application/utils/intents.spec.ts`](../../../src/application/utils/intents.spec.ts): Unit coverage for normalization and conversational intent detection.
- [`src/application/use-cases/conversation/RouteIncomingMessage.spec.ts`](../../../src/application/use-cases/conversation/RouteIncomingMessage.spec.ts): Application-level routing coverage for commands that must bypass non-financial guidance.
- [`src/interfaces/http/routes/telegram.webhook.integration.spec.ts`](../../../src/interfaces/http/routes/telegram.webhook.integration.spec.ts): Pipeline-level regression coverage proving Telegram undo text reaches `process-message` rather than receiving guidance.
- [`src/interfaces/workers/message.worker.spec.ts`](../../../src/interfaces/workers/message.worker.spec.ts): Existing worker coverage for normalized undo commands and undo outcomes.
- [`docs/features/undo-last-expense.md`](../../../docs/features/undo-last-expense.md): Canonical undo behavior, including immediate eligibility and supported normalized commands.
- [`docs/features/incoming-message-routing.md`](../../../docs/features/incoming-message-routing.md): Canonical routing contract that must state that global undo commands bypass non-financial guidance.
- [`docs/features/README.md`](../../../docs/features/README.md): Feature index that must remain synchronized when feature documentation changes.
- [`docs/adr/adr.md`](../../../docs/adr/adr.md): ADR-003 defines the persisted FSM, ADR-005 defines asynchronous processing, and ADR-011 defines the incoming-message and process-message queue pipeline.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): Test placement, negative assertions, coverage requirements, and mocked external-boundary rules.
- [`docs/testing/e2e-mvp/E2E-07-undo-last-expense.md`](../../../docs/testing/e2e-mvp/E2E-07-undo-last-expense.md): Manual acceptance scenario that reproduces the regression and validates the corrected behavior.

## Phases

### Phase 1: Route undo commands to the FSM worker

#### Description

Introduce one shared undo-intent contract, use it consistently at both routing layers, add regression coverage across the application and Telegram pipeline, and synchronize the canonical routing documentation. This phase changes no HTTP schema, queue payload, database schema, or user-facing copy.

#### To-do actions

- [x] Add the exported application utility `isUndoIntent(rawMessage: string): boolean` to `src/application/utils/intents.ts`.
- [x] Preserve the currently supported exact commands `deshacer`, `undo`, and `borrar el último`, including case-insensitive, whitespace-trimmed, and accent-insensitive normalization.
- [x] Add focused unit cases to `src/application/utils/intents.spec.ts` for every supported variant and representative non-undo text to prevent false positives.
- [x] Update `RouteIncomingMessage` so a non-financial undo intent in `IDLE` or `EXPENSE_RECEIVING` bypasses guidance and is enqueued unchanged to `process-message`.
- [x] Preserve existing routing for ordinary non-financial text, global cancellation commands, expense-like text, too-long text, and messages received in active FSM states.
- [x] Replace the private `isUndoCommand` implementation in `message.worker.ts` with the shared `isUndoIntent` contract so command normalization has one source of truth.
- [x] Extend `RouteIncomingMessage.spec.ts` with parameterized cases proving all supported undo commands are enqueued, guidance is not sent, and the original text is preserved in the job payload.
- [x] Keep or adapt `message.worker.spec.ts` assertions to prove the shared detector still invokes `UndoLastExpenseUseCase` and never invokes expense interpretation for undo commands.
- [x] Add a Telegram pipeline regression case to `telegram.webhook.integration.spec.ts` proving an immediate `deshacer` reaches `process-message` instead of producing expense guidance.
- [x] Include negative assertions that guidance is not sent for undo commands and that ordinary non-financial text remains unqueued.
- [x] Update `docs/features/incoming-message-routing.md` to document that global undo commands bypass the idle-state non-financial filter and reach the FSM worker.
- [x] Update the `incoming-message-routing.md` entry in `docs/features/README.md` so the feature index reflects command-aware routing.
- [x] Verify that `docs/features/undo-last-expense.md` remains accurate; change it only if implementation details introduced by this fix require synchronization, and update the feature index in the same change if it is modified.
- [x] Run the focused Vitest suites for intents, incoming-message routing, message worker, and Telegram webhook integration; fix failures if any.
- [x] Run `pnpm test` to verify the complete regression suite, including undo behavior; fix failures if any.
- [ ] Manually repeat `docs/testing/e2e-mvp/E2E-07-undo-last-expense.md` in the target environment and record the result only after the first undo removes the saved row and the second undo safely removes nothing else.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Manually repeat E2E-07 in the target Telegram and Google Sheets environment, then record the result to complete Phase 1.
