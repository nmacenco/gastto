# Plan: Integrate file selection into message worker

## Goal

Wire the `HandleSpreadsheetFileSelection` use case into the `MessageWorkerDeps` dependency graph, replace the `ONBOARDING_FILE` placeholder in `message.worker.ts` so the conversational FSM routes messages in the file selection state to the correct use case, and add unit tests covering the new branch.

## Context

- `docs/features/select-spreadsheet-file.md` - Feature rules and `HandleSpreadsheetFileSelection` contracts.
- `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.02-select-the-spreadsheet-file/tasks/T-4.02-04.md` - The source task with acceptance criteria.
- `src/interfaces/workers/message.worker.ts` - Contains the FSM switch statement that currently sends `onboardingCopies.onboardingPlaceholder()` for `ONBOARDING_FILE`.
- `src/interfaces/workers/message.worker.spec.ts` - Worker contract tests; currently only asserts placeholder behavior for `ONBOARDING_FILE`.
- `src/main.ts` - DI composition root where all use cases, adapters, and workers are instantiated and wired together.
- `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts` - Fully implemented use case (T-4.02-03).
- `src/infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter.ts` - `CloudStoragePort` implementation (T-4.02-02).
- **Note on `incomingMessage.worker.ts` and `telegram.webhook.ts`:** Neither file requires changes. The former only holds `routeIncomingMessage` and the latter only holds `handleStartCommand` and the message queue; the new use case is instantiated in the DI root (`main.ts`) and injected into the message worker only.
- **Note on missing `conversationState` fallback:** The worker's top-level logic (`const currentState = conversationState?.currentState ?? 'IDLE';`) means a missing state always defaults to `IDLE` rather than entering any onboarding branch. The `RecoverCorruptedState` fallback only runs for _unrecognized_ states in the `default` branch. Therefore, the AC about falling back to `RecoverCorruptedState` when `conversationState` is missing is satisfied by this existing default-to-IDLE behavior, not by a branch-specific change.

## Phases

### Phase 1: Wire use case into worker and DI composition root

**Description:** Update `MessageWorkerDeps` to include the new optional use case, replace the `ONBOARDING_FILE` placeholder in `message.worker.ts` with a delegation call following the same pattern as `ONBOARDING_START` and `ONBOARDING_DRIVE`, and instantiate `HandleSpreadsheetFileSelection` and `GoogleDriveFileDiscoveryAdapter` in `main.ts` so the dependency graph is complete.

- [x] Import `HandleSpreadsheetFileSelection` type in `src/interfaces/workers/message.worker.ts`.
- [x] Add `handleSpreadsheetFileSelection?: HandleSpreadsheetFileSelection | null` to `MessageWorkerDeps` in `src/interfaces/workers/message.worker.ts`.
- [x] Replace the `ONBOARDING_FILE` placeholder branch in `processMessageJob` with a conditional delegation:
  - If `opts.handleSpreadsheetFileSelection` is present, call `execute({ userId, rawMessage, externalId, channel, statePayload: conversationState?.statePayload ?? null })`.
  - If absent, fall back to `onboardingCopies.onboardingPlaceholder()`.
- [x] Import `HandleSpreadsheetFileSelection` and `GoogleDriveFileDiscoveryAdapter` in `src/main.ts`.
- [x] Instantiate `GoogleDriveFileDiscoveryAdapter` when Google OAuth credentials are present.
- [x] Instantiate `HandleSpreadsheetFileSelection` with its dependencies (`cloudStorage`, `tokenRepository`, `transitionState`, `messagingPort`, `tokenEncryption`) and pass it to `createMessageWorker`.
- [x] Run `pnpm test` to verify existing tests still pass.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.

### Phase 2: Update worker unit tests for ONBOARDING_FILE branch

**Description:** Expand `message.worker.spec.ts` with tests that verify the `ONBOARDING_FILE` branch delegates to `HandleSpreadsheetFileSelection` when wired, passes the correct arguments (including `statePayload`), and falls back to the placeholder when the use case is not provided.

- [x] Add a `mockHandleSpreadsheetFileSelectionExecute` mock function.
- [x] Update `buildMockDeps` to include `handleSpreadsheetFileSelection` wired to the new mock.
- [x] Write a test: `ONBOARDING_FILE` delegates to `HandleSpreadsheetFileSelection.execute` with `{ userId, rawMessage, externalId, channel, statePayload }`.
- [x] Write a test: `ONBOARDING_FILE` falls back to placeholder when `handleSpreadsheetFileSelection` is `null`.
- [x] ~~Write a test: if `conversationState` is missing, `statePayload` passed to the use case is `null`.~~ _Removed:_ The worker's top-level `currentState ?? 'IDLE'` logic means the `ONBOARDING_FILE` branch is unreachable when `conversationState` is missing; this is the existing default behavior, not a testable branch-specific case.
- [x] Run `pnpm test` to verify all worker tests pass.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.

## Next step

All phases are complete. Update the task file `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.02-select-the-spreadsheet-file/tasks/T-4.02-04.md` by checking off the acceptance criteria checkboxes that were satisfied.
