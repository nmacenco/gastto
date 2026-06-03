# Cloud Storage Connection

## Overview

The Cloud Storage Connection feature enables users to link their spreadsheet (Google Drive or OneDrive) during the conversational onboarding flow. For the MVP, only **Google Drive** is supported. Selecting OneDrive returns a friendly "coming soon" message.

## Scope

- **In scope:** Google Drive OAuth2 authorization, CSRF state management, reminder scheduling, OAuth callback handling, user cancellation during the OAuth flow.
- **Out of scope:** OneDrive adapter, file/sheet/mapping selection.

## FSM States

| State              | Description                                                         | Next                                                                                         |
| ------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ONBOARDING_START` | User is asked to choose a cloud provider                            | `ONBOARDING_DRIVE` (Google) or stays here (invalid / OneDrive)                               |
| `ONBOARDING_DRIVE` | User has received the Google auth link and is expected to authorize | `ONBOARDING_FILE` (callback success), `IDLE` (cancel), self-transition (`SendOAuthReminder`) |

## OAuth Flow Sequence

### Initiation (`InitiateCloudConnection`)

1. User sends a message while in `ONBOARDING_START`.
2. `InitiateCloudConnection` parses the provider choice.
3. For **Google Drive**:
   - Generates a cryptographically random `state` (32 bytes hex).
   - Builds the Google OAuth URL via `GoogleDriveOAuthAdapter.buildAuthUrl()`.
   - Stores `oauth:state:{state}` in Redis with a **15-minute TTL**.
   - Schedules a BullMQ job on the `oauth-reminder` queue with a **10-minute delay**.
   - Sends the auth link to the user via `MessagingOutputPort`.
   - Transitions FSM to `ONBOARDING_DRIVE`.
4. For **OneDrive**: returns a "coming soon" message; state remains `ONBOARDING_START`.
5. For **invalid input**: returns a re-prompt; state remains `ONBOARDING_START`.

### Callback (`HandleOAuthCallback`)

6. User completes Google authorization and the redirect delivers `code` + `state`.
7. `HandleOAuthCallback`:
   - Validates the `state` against Redis (`oauth:state:{state}`).
   - Exchanges the `code` for tokens via `GoogleDriveOAuthAdapter.exchangeCode()`.
   - Encrypts tokens (AES-256-GCM) and persists them via `IOAuthTokenRepository.upsert()`.
   - Cancels the pending BullMQ reminder job using the stored `reminderJobId`.
   - Removes the Redis CSRF key.
   - Sends a success confirmation to the user.
   - Transitions FSM to `ONBOARDING_FILE`.

### Reminder (`SendOAuthReminder`)

8. If the user has not completed authorization within **10 minutes**, the BullMQ job fires.
9. `SendOAuthReminder`:
   - Checks if tokens already exist; if so, silently skips.
   - Generates a fresh CSRF `state`.
   - Builds a new auth URL and stores the new state in Redis (15-minute TTL).
   - Schedules a new BullMQ reminder job for +10 minutes.
   - Updates the FSM payload via self-transition `ONBOARDING_DRIVE` → `ONBOARDING_DRIVE`.
   - Resends the auth link to the user.

### Cancellation (`CancelCloudConnection`)

10. If the user types "cancelar" while in `ONBOARDING_DRIVE`:
    - `CancelCloudConnection` removes the Redis CSRF key and cancels the pending reminder job.
    - Transitions FSM to `IDLE`.
    - Sends a friendly cancellation message.

## Redis Key Patterns

| Key                   | Value                                                            | TTL            |
| --------------------- | ---------------------------------------------------------------- | -------------- |
| `oauth:state:{state}` | JSON: `{ userId, provider, externalId, channel, reminderJobId }` | 15 min (900 s) |

## BullMQ Reminder Queue

- **Queue name:** `oauth-reminder`
- **Job delay:** 10 minutes (600 000 ms)
- **Job payload:** `{ userId, externalId, channel }`
- The `reminderJobId` stored in Redis allows future cancellation when the user completes the callback.

## Error Handling and Retry Behavior

| Scenario                              | Behavior                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| User denies authorization             | `HandleOAuthCallback` catches `OAuthDeniedError`, returns `success: false` with `canRetry: true` and a retry prompt. |
| Network failure during token exchange | `HandleOAuthCallback` catches `OAuthNetworkError`, returns `success: false` with `canRetry: true`.                   |
| Invalid / missing `state` on callback | `HandleOAuthCallback` catches `OAuthStateMismatchError`, returns `success: false` with `canRetry: true`.             |
| Token persistence failure             | `HandleOAuthCallback` returns `success: false` with `canRetry: true`; no success message is sent.                    |
| Reminder cancellation failure         | Logged via `console.error` but does not block callback success.                                                      |
| Invalid provider requested            | `InitiateCloudConnection` throws `InvalidProviderError` (caught by caller).                                          |
| BullMQ reminder job failure           | Retries with exponential backoff (3 attempts).                                                                       |
| Cancellation with missing Redis state | `CancelCloudConnection` still transitions to `IDLE` and sends the cancellation message.                              |

## Adapters

- `GoogleDriveOAuthAdapter` — direct `fetch` calls to Google OAuth endpoints. No `google-auth-library` dependency.
- `InitiateCloudConnection` — Application use case that starts the OAuth flow.
- `HandleOAuthCallback` — Application use case that completes the OAuth flow after redirect.
- `CancelCloudConnection` — Application use case that cancels an in-progress OAuth flow.
- `SendOAuthReminder` — Application use case that re-sends the auth link with a fresh CSRF state.

## Configuration

The following environment variables are required once the adapter is wired:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

All three are optional in `env.schema.ts` so the app can bootstrap without them during skeleton phases.
