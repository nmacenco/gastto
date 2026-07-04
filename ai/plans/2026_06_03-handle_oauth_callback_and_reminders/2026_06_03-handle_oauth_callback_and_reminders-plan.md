# Plan: Handle OAuth Callback, Cancel & Reminder Use Cases

## Goal

Implement `HandleOAuthCallback`, `CancelCloudConnection`, and `SendOAuthReminder` use cases to complete the OAuth flow state management. This covers callback validation, token persistence, reminder scheduling, user cancellation, and the FSM transitions required for each scenario.

## Context

- `src/application/use-cases/spreadsheet/InitiateCloudConnection.ts` — existing use case that starts the flow, stores CSRF state in Redis, schedules the BullMQ reminder job, and transitions to `ONBOARDING_DRIVE`.
- `src/domain/ports/oauth.ts` — `OAuthServicePort` with `buildAuthUrl` and `exchangeCode`.
- `src/domain/ports/repositories.ts` — `IOAuthTokenRepository` for persisting encrypted tokens.
- `src/domain/entities/ConversationState.ts` — FSM states and `FSM_TRANSITIONS`; requires adding `ONBOARDING_DRIVE` self-transition and `ONBOARDING_DRIVE` → `IDLE`.
- `src/application/copies/onboarding.copies.ts` — text copies; needs success, error, cancel, and reminder messages.
- `src/domain/errors/` — domain errors (`OAuthStateMismatchError`, `OAuthDeniedError`, `OAuthNetworkError`) already defined.
- `docs/testing/guidelines.md` — testing rules, coverage targets, and FSM checklist.
- `docs/features/cloud-storage-connection.md` — feature documentation describing the OAuth flow, Redis key patterns, and BullMQ reminder queue.

## Public Contracts

### Application Services

- `HandleOAuthCallback.execute(input: { code: string; state: string }) → { success: boolean; nextState: FsmState; message: string; errorMessage?: string; canRetry?: boolean }`
- `CancelCloudConnection.execute(input: { userId: string; state: string; externalId: string; channel: 'telegram' | 'whatsapp' }) → { nextState: FsmState; message: string }`
- `SendOAuthReminder.execute(input: { userId: string; externalId: string; channel: 'telegram' | 'whatsapp' }) → { message: string }`

### Database Schemas

- No schema changes. `oauth_tokens` table already exists.

### Test Suites

- `src/application/use-cases/spreadsheet/HandleOAuthCallback.spec.ts`
- `src/application/use-cases/spreadsheet/CancelCloudConnection.spec.ts`
- `src/application/use-cases/spreadsheet/SendOAuthReminder.spec.ts`

### Text Copies (End User)

- `onboardingCopies.googleConnectedSuccess()`
- `onboardingCopies.onedriveConnectedSuccess()`
- `onboardingCopies.connectionFailed(canRetry: boolean)`
- `onboardingCopies.cancelledMessage()`
- `onboardingCopies.reminderMessage(url: string)`

## Phases

### Phase 1: HandleOAuthCallback Use Case

**Description:** Implement the use case that receives the OAuth callback (`code` + `state`), validates the CSRF state against Redis, exchanges the code for tokens via `OAuthServicePort`, persists encrypted tokens via `IOAuthTokenRepository`, cancels the pending BullMQ reminder job, sends a success confirmation to the user, and transitions the FSM to `ONBOARDING_FILE`.

- [x] Create `src/application/use-cases/spreadsheet/HandleOAuthCallback.ts` with the use case class and DTOs.
- [x] Add success and error copy messages to `src/application/copies/onboarding.copies.ts`.
- [x] Create `src/application/use-cases/spreadsheet/HandleOAuthCallback.spec.ts` with unit tests covering:
  - Valid callback: state matches, tokens exchanged, persisted, reminder cancelled, success message sent, state transitions to `ONBOARDING_FILE`.
  - Invalid/missing `state`: throws `OAuthStateMismatchError`, returns `success: false`, `canRetry: true`.
  - User denies authorization: `OAuthDeniedError`, returns `success: false`, `canRetry: true`.
  - Network failure during token exchange: `OAuthNetworkError`, returns `success: false`, `canRetry: true`.
  - Token persistence failure: returns `success: false`, no messaging call, `canRetry: true`.
  - Reminder job cancellation failure: logged but does not block success.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: CancelCloudConnection and SendOAuthReminder Use Cases

**Description:** Implement cancellation when the user types "cancelar" during the OAuth flow, and the 10-minute reminder that resends the auth link with a fresh CSRF state if the user hasn't completed authorization. Update the FSM to allow self-transitions for `ONBOARDING_DRIVE` and transitions back to `IDLE`.

- [x] Update `FSM_TRANSITIONS` in `src/domain/entities/ConversationState.ts`:
  - Add `ONBOARDING_DRIVE` → `ONBOARDING_DRIVE` (self-transition for `SendOAuthReminder` updating payload).
  - Add `ONBOARDING_DRIVE` → `IDLE` (for `CancelCloudConnection`).
- [x] Create `src/application/use-cases/spreadsheet/CancelCloudConnection.ts`:
  - Removes OAuth state from Redis using the `state` from payload.
  - Cancels the pending BullMQ reminder job using the stored `reminderJobId`.
  - Transitions FSM to `IDLE`.
  - Returns `nextState: 'IDLE'` and a friendly cancellation message.
- [x] Create `src/application/use-cases/spreadsheet/SendOAuthReminder.ts`:
  - Checks if tokens already exist for the user; if yes, skips and returns an empty/placeholder message.
  - Generates a fresh CSRF state.
  - Builds a new auth URL via `OAuthServicePort.buildAuthUrl()`.
  - Stores the new state in Redis with 15-minute TTL, preserving `userId`, `provider`, `externalId`, `channel`, and a new `reminderJobId`.
  - Schedules a new BullMQ reminder job for +10 minutes.
  - Updates the conversation state payload with the new `state` via `TransitionConversationState` (self-transition `ONBOARDING_DRIVE` → `ONBOARDING_DRIVE`).
  - Sends the auth link again via `MessagingOutputPort`.
  - Returns the reminder message.
- [x] Add cancel and reminder copy messages to `src/application/copies/onboarding.copies.ts`.
- [x] Create `src/application/use-cases/spreadsheet/CancelCloudConnection.spec.ts` with unit tests covering:
  - Valid cancellation: Redis key deleted, BullMQ job cancelled, FSM transitions to `IDLE`.
  - Missing state in Redis: still transitions to `IDLE`, no crash.
  - BullMQ job cancellation failure: logged but does not block cancellation.
- [x] Create `src/application/use-cases/spreadsheet/SendOAuthReminder.spec.ts` with unit tests covering:
  - Reminder sent with fresh state: new Redis key, new BullMQ job, FSM payload updated, message sent.
  - Tokens already exist: no reminder sent, no side effects.
  - Redis state update failure: returns `success: false` or throws appropriate error.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Documentation Sync

**Description:** Update canonical feature documentation to reflect the implemented callback handling, cancellation, and reminder behavior. Update the FSM state table, error handling matrix, and sequence diagrams.

- [x] Update `docs/features/cloud-storage-connection.md`:
  - Expand the FSM States table with `ONBOARDING_DRIVE` → `ONBOARDING_FILE` (callback success) and `ONBOARDING_DRIVE` → `IDLE` (cancellation).
  - Add `ONBOARDING_DRIVE` self-transition for `SendOAuthReminder`.
  - Update the OAuth Flow Sequence to include callback handling (`HandleOAuthCallback`) and reminder re-scheduling (`SendOAuthReminder`).
  - Update the Error Handling and Retry Behavior table with `OAuthStateMismatchError` and `OAuthDeniedError` scenarios.
- [x] Update `docs/architecture/data-model.md` if any new indexes or constraints were added (not expected, but verify).
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next Step

All phases completed. Plan is fully implemented.
