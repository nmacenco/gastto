# Fix Google Drive API 400 and OAuth Reminder Worker Crash

## Goal

Fix two bugs discovered during production testing: (1) Google Drive API returning HTTP 400 due to invalid `mimeType in (...)` query syntax, and (2) OAuth reminder worker permanently crashing with `InvalidStateTransitionError` when the user has already moved out of `ONBOARDING_DRIVE`.

## Context

- `src/infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter.ts`: `buildMimeTypeQuery()` uses `mimeType in (...)` which Google Drive API v3 does not support for standard fields. Must use `or` with `=`.
- `src/application/use-cases/spreadsheet/SendOAuthReminder.ts`: Always calls `transitionState.execute({ targetState: 'ONBOARDING_DRIVE' })` without checking the current user state.
- `src/interfaces/workers/oauthReminder.worker.ts`: `processOAuthReminderJob` delegates directly to `SendOAuthReminder.execute()` with no error handling for state transitions.
- `src/domain/entities/ConversationState.ts`: Defines `FSM_TRANSITIONS` including `ONBOARDING_DRIVE -> [ONBOARDING_FILE, ONBOARDING_DRIVE, IDLE]`. `IDLE -> ONBOARDING_DRIVE` is invalid.
- Relevant docs: `docs/features/cloud-storage-connection.md`, `docs/testing/guidelines.md`.
- Public contracts affected: `onboardingCopies.connectionFailed()` text shown to user, `FileDiscoveryError` adapter behavior, `SendOAuthReminder` use case method signature (no change, but behavior changes).

## Phases

### Phase 1: Fix Google Drive API query syntax and add error logging

**Description:** Replace `mimeType in (...)` with `mimeType = '...' or ...` in `buildMimeTypeQuery()`. Add structured logging of the error response body in `fetchFiles()` and `validateFileAccess()` when Google Drive API returns non-2xx, so future failures include the exact error message from Google.

**Actions:**

- [x] Update `buildMimeTypeQuery()` in `GoogleDriveFileDiscoveryAdapter.ts` to use `or` with `=`.
- [x] Update `GoogleDriveFileDiscoveryAdapter.spec.ts` tests to assert the corrected query format.
- [x] Add `response.json()` parsing + `console.error({ endpoint, code, errorBody })` in `fetchFiles()` and `validateFileAccess()` when `!response.ok`.
- [x] Add tests for the new error logging behavior in `GoogleDriveFileDiscoveryAdapter.spec.ts`.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Guard reminder worker against invalid state transitions

**Description:** In `SendOAuthReminder`, check the current conversation state before attempting a transition to `ONBOARDING_DRIVE`. If the user is no longer in `ONBOARDING_DRIVE`, silently skip (the reminder is stale). In `oauthReminder.worker`, catch `InvalidStateTransitionError` gracefully so the BullMQ job does not fail permanently.

**Actions:**

- [x] Add `IConversationStateRepository` dependency to `SendOAuthReminderDeps`.
- [x] In `SendOAuthReminder.execute()`, read current state via `conversationRepo.findByUserId()`. If state is not `ONBOARDING_DRIVE`, return early with empty message.
- [x] Update `SendOAuthReminder.spec.ts` to mock the new dependency and cover the "stale reminder" path.
- [x] In `oauthReminder.worker.ts`, wrap `sendOAuthReminder.execute()` in a `try/catch` for `InvalidStateTransitionError`. Log a structured warning and resolve successfully.
- [x] Update `oauthReminder.worker.spec.ts` to test the graceful handling of invalid transitions.
- [x] Update `main.ts` wiring of `SendOAuthReminder` to inject the conversation repository.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next Step

Both phases are complete. Suggest the user to review the changes and optionally commit them.
