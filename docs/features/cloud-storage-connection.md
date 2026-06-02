# Cloud Storage Connection

## Overview

The Cloud Storage Connection feature enables users to link their spreadsheet (Google Drive or OneDrive) during the conversational onboarding flow. For the MVP, only **Google Drive** is supported. Selecting OneDrive returns a friendly "coming soon" message.

## Scope

- **In scope:** Google Drive OAuth2 authorization, CSRF state management, reminder scheduling.
- **Out of scope:** OneDrive adapter, OAuth callback handling (see Task T-4.01-06), file/sheet/mapping selection.

## FSM States

| State              | Description                                                         | Next                                                           |
| ------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `ONBOARDING_START` | User is asked to choose a cloud provider                            | `ONBOARDING_DRIVE` (Google) or stays here (invalid / OneDrive) |
| `ONBOARDING_DRIVE` | User has received the Google auth link and is expected to authorize | `ONBOARDING_FILE` (after callback)                             |

## OAuth Flow Sequence

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

| Scenario                              | Behavior                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| User denies authorization             | `GoogleDriveOAuthAdapter.exchangeCode()` throws `OAuthDeniedError` (handled in T-4.01-06) |
| Network failure during token exchange | Throws `OAuthNetworkError`                                                                |
| Invalid / missing `state` on callback | Throws `OAuthStateMismatchError`                                                          |
| Invalid provider requested            | Throws `InvalidProviderError`                                                             |
| BullMQ reminder job failure           | Retries with exponential backoff (3 attempts)                                             |

## Adapters

- `GoogleDriveOAuthAdapter` — direct `fetch` calls to Google OAuth endpoints. No `google-auth-library` dependency.
- `InitiateCloudConnection` — Application use case that orchestrates the flow.

## Configuration

The following environment variables are required once the adapter is wired:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

All three are optional in `env.schema.ts` so the app can bootstrap without them during skeleton phases.
