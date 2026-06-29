# Allow reconnect transitions from onboarding file, sheet, and mapping states

## 🎯 Goal

Fix the `InvalidStateTransitionError` that occurs when reconnect flows try to move a user from `ONBOARDING_FILE`, `ONBOARDING_SHEET`, or `ONBOARDING_MAPPING` back to `ONBOARDING_START` after a missing, expired, or decryption-failed Google token. The fix will align these states with `ONBOARDING_VALIDATING_ACCESS`, which already allows reconnect transitions to `ONBOARDING_START`.

## 👀 Context

- The onboarding state machine is defined in [`src/domain/entities/ConversationState.ts`](src/domain/entities/ConversationState.ts).
  - `FSM_TRANSITIONS` (lines 45-60) lists every legal state transition.
  - `canTransition` (lines 62-63) is the strict guard used by `TransitionConversationState`.
- The reconnect handlers that target `ONBOARDING_START` are:
  - [`HandleSpreadsheetFileSelection.handleReconnect`](src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts)
  - [`HandleSheetSelection.handleReconnect`](src/application/use-cases/spreadsheet/HandleSheetSelection.ts)
  - [`InferColumnMapping.handleReconnect`](src/application/use-cases/spreadsheet/InferColumnMapping.ts)
  - [`ValidateSpreadsheetAccess.handleReconnect`](src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts) (already works because `ONBOARDING_VALIDATING_ACCESS` allows `ONBOARDING_START`).
- The error is thrown by [`TransitionConversationState.execute`](src/application/use-cases/conversation/TransitionConversationState.ts) when `canTransition` returns `false`.
- Existing unit tests for the spreadsheet use cases mock `transitionState.execute`, so they do not exercise the real FSM guard. The FSM tests live in [`src/domain/entities/ConversationState.spec.ts`](src/domain/entities/ConversationState.spec.ts).
- Relevant architecture docs:
  - [`docs/adr/adr.md`](docs/adr/adr.md) for state-machine decisions.
  - [`docs/architecture/data-model.md`](docs/architecture/data-model.md) for state definitions.
  - [`docs/features/conversation-state-management.md`](docs/features/conversation-state-management.md) for the FSM reference table (to be updated if transitions change).

## 🪜 Phases

### Phase 1: Extend FSM transitions and add domain tests

Description: Update the strict FSM transition table to allow reconnect transitions from `ONBOARDING_FILE`, `ONBOARDING_SHEET`, and `ONBOARDING_MAPPING` to `ONBOARDING_START`. Add unit tests in the FSM spec to cover the new transitions.

Public contracts modified:
- Domain FSM contract: `FSM_TRANSITIONS` in `src/domain/entities/ConversationState.ts`.
- Test suite: `src/domain/entities/ConversationState.spec.ts`.

To-do:

- [x] Add `ONBOARDING_START` to the allowed targets for `ONBOARDING_FILE`.
- [x] Add `ONBOARDING_START` to the allowed targets for `ONBOARDING_SHEET`.
- [x] Add `ONBOARDING_START` to the allowed targets for `ONBOARDING_MAPPING`.
- [x] Update the parameterized allowed-transitions test in `ConversationState.spec.ts` to include the three new transitions.
- [x] Run `pnpm test src/domain/entities/ConversationState.spec.ts` and verify all tests pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Sync documentation and run full verification

Description: Update the onboarding feature documentation to reflect the new reconnect transitions, then run the full test suite, lint, and typecheck to ensure nothing is broken.

Public contracts modified:
- Documentation: `docs/features/conversation-state-management.md`.

To-do:

- [x] Update `docs/features/conversation-state-management.md` to document that `ONBOARDING_FILE`, `ONBOARDING_SHEET`, and `ONBOARDING_MAPPING` allow transitions back to `ONBOARDING_START` during reconnect.
- [x] Run `pnpm test` to verify the full suite passes.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## ⏭️ Next step

All phases completed. Review the changes and decide whether to commit them.
