# Select Spreadsheet File

## Overview

The Select Spreadsheet File feature enables users to choose which spreadsheet file in their connected cloud storage account should receive their expense records. After completing the OAuth flow (Cloud Storage Connection), the bot enters the `ONBOARDING_FILE` state and guides the user through discovering, searching, and selecting a spreadsheet file.

## Scope

- **In scope:** Google Drive file discovery, search by name, direct URL validation, file selection, and access validation.
- **Out of scope:** OneDrive file discovery (MVP returns "coming soon"), sheet selection (handled by HU-4.03), column mapping (handled by HU-4.04).

## FSM States

| State             | Description                                                   | Next                                                                |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ONBOARDING_FILE` | User is selecting a spreadsheet file from their cloud storage | `ONBOARDING_SHEET` (file selected), self-transition (search / list) |

## File Discovery Flow Sequence

### Initial Listing (`HandleSpreadsheetFileSelection`)

1. After a successful OAuth callback, `HandleOAuthCallback` transitions the user to `ONBOARDING_FILE` and immediately invokes `HandleSpreadsheetFileSelection` with an empty `rawMessage`.
2. `HandleSpreadsheetFileSelection` calls `CloudStoragePort.listRecentSpreadsheets`.
3. The adapter queries Google Drive API v3 for the 5 most recently modified spreadsheet files.
4. The use case formats a numbered list of files and appends a "None of these / search by name" option.
5. The file list is stored in the FSM payload via `TransitionConversationState`.
6. The user receives the formatted list message.

### Selection by Number

7. User replies with a number matching an item in `statePayload.fileList`.
8. The use case validates the choice and calls `CloudStoragePort.validateFileAccess` to confirm permissions.
9. The selected `fileId`, `fileName`, and `provider` are stored in the payload with a compare-and-swap transition bound to the displayed-list revision.
   > **Note:** The selected file is stored in `conversationStates.statePayload` until HU-4.04 creates the definitive `spreadsheet_configs` record.
10. FSM transitions to `ONBOARDING_SHEET`, then a confirmation message with the full file name is sent via `MessagingOutputPort`.
11. A stale transition sends no success confirmation.
12. `HandleSpreadsheetFileSelection` immediately invokes `HandleSheetSelection` with an empty `rawMessage`, so sheet discovery (single-sheet auto-confirmation or multi-sheet list) happens before the user sends another message.

### Semantic selection by displayed reference

- In `enabled` mode, `ONBOARDING_FILE/default` may propose `select_option` with only an untrusted `userReference`. Numeric deterministic replies, the "none of these" branch, active search queries, direct Drive URLs, initial listing, and Microsoft-unavailable handling bypass the semantic provider.
- `DispatchOptionSelection` reloads and validates revision, state, expiry, execution ownership, payload shape, ordered positions, and labels. It resolves an exact normalized full label or documented Spanish ordinal/cardinal to exactly one position; duplicate labels are ambiguous and no provider identifier comes from the model.
- A resolved position is passed once to `selectDisplayedFile`. That typed entry point reuses access validation, the guarded transition, confirmation, and isolated eager sheet discovery without reinterpreting text.
- Ambiguous, unavailable, and stale references retain `ONBOARDING_FILE`, send bounded application-owned guidance, and perform no file-access validation, transition, sheet discovery, configuration write, spreadsheet probe, or success confirmation.

### Search by Name

12. If the user chooses "None of these / search by name", the use case prompts for a file name.
13. When `statePayload.step === 'searching'`, the use case calls `CloudStoragePort.searchSpreadsheets` with the user's message as query.
14. A refined list is presented and the payload is updated.

### Direct URL Validation

15. If the user pastes a Google Drive or OneDrive URL, the use case extracts the `fileId`.
16. `CloudStoragePort.validateFileAccess` is called to verify permissions.
17. If accessible, the file is selected, the payload is updated with `selectedFileId`, `selectedFileName`, and `provider`, and the FSM transitions to `ONBOARDING_SHEET`.
18. `HandleSpreadsheetFileSelection` immediately invokes `HandleSheetSelection` with an empty `rawMessage` to trigger sheet discovery automatically.
19. If access is denied, the user is informed of permission issues.

### No Compatible Files

18. If no compatible files are found, the use case returns a clear message suggesting verification and offering manual name entry.

## Adapters

- `GoogleDriveFileDiscoveryAdapter` — direct `fetch` calls to Google Drive API v3. No `googleapis` SDK dependency.
- `CloudStoragePort` — Domain interface that decouples the Application layer from Google Drive specifics.

## Configuration

No additional environment variables are required. The adapter uses the same OAuth `accessToken` retrieved from the token repository during the `HandleSpreadsheetFileSelection` use case.

## API Contracts

### Application DTOs

#### `HandleSpreadsheetFileSelectionInput`

```ts
interface HandleSpreadsheetFileSelectionInput {
  userId: string;
  rawMessage: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}
```

#### `HandleSpreadsheetFileSelectionOutput`

```ts
interface HandleSpreadsheetFileSelectionOutput {
  nextState: FsmState;
  message: string;
  payload?: Record<string, unknown>;
}
```

#### `SelectDisplayedFileInput`

```ts
interface SelectDisplayedFileInput extends Omit<HandleSpreadsheetFileSelectionInput, 'rawMessage'> {
  position: number;
  expected: ConversationStatePrecondition;
}
```

#### `HandleSpreadsheetFileSelectionDeps`

```ts
interface HandleSpreadsheetFileSelectionDeps {
  cloudStorage: CloudStoragePort;
  oauthAccessTokenService: OAuthAccessTokenProvider;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  logger: Logger;
  handleSheetSelection: HandleSheetSelection;
}
```

### Domain Port

#### `CloudStoragePort`

```ts
interface CloudStoragePort {
  listRecentSpreadsheets(accessToken: string, provider: SpreadsheetProvider): Promise<CloudFile[]>;
  searchSpreadsheets(
    accessToken: string,
    provider: SpreadsheetProvider,
    query: string,
  ): Promise<CloudFile[]>;
  validateFileAccess(
    fileId: string,
    accessToken: string,
    provider: SpreadsheetProvider,
  ): Promise<boolean>;
}
```

#### `CloudFile` Value Object

```ts
class CloudFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly modifiedAt: Date;
}
```

## Error Handling

| Scenario                           | Behavior                                                               |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Invalid provider (`microsoft`)     | `InvalidProviderError` thrown by adapter; use case sends `comingSoon`. |
| Missing / expired / revoked token  | `reconnectAccount` message sent; transitions to `ONBOARDING_START`.    |
| Token decryption failure           | `reconnectAccount` message sent; transitions to `ONBOARDING_START`.    |
| Missing `fileId` in statePayload   | `fileAccessFailed` message returned; stays in `ONBOARDING_FILE`.       |
| Network failure during discovery   | `FileDiscoveryError` thrown; `fileDiscoveryFailed` returned.           |
| Non-2xx HTTP from Google Drive API | `FileDiscoveryError` thrown with HTTP status; error message returned.  |
| Invalid JSON response              | `FileDiscoveryError` thrown; `fileDiscoveryFailed` returned.           |
| File access denied (403/404)       | `validateFileAccess` returns `false`; `urlValidationFailed` returned.  |
| Unexpected HTTP during validation  | `FileDiscoveryError` thrown; `fileAccessFailed` returned.              |

## QA Checklist

### Google Drive

- [x] **Happy path — list recent files:**
  - User enters `ONBOARDING_FILE`.
  - `GoogleDriveFileDiscoveryAdapter` queries Drive API with correct mimeTypes, orderBy, pageSize, and fields.
  - Response mapped to `CloudFile[]` with correct `id`, `name`, `mimeType`, `modifiedAt`.
  - Numbered list (max 5 items) sent to user.
  - "None of these / search by name" option appended.
  - File list stored in `statePayload`.

- [x] **Happy path — selection by number:**
  - User sends a number matching `statePayload.fileList`.
  - `validateFileAccess` returns `true`.
  - Confirmation message sent with full file name.
  - `selectedFileId`, `selectedFileName`, and `provider` stored in payload.
  - FSM transitions to `ONBOARDING_SHEET`.
  - `HandleSheetSelection` invoked automatically with empty `rawMessage`.

- [x] **Happy path — semantic displayed reference:**
  - Natural full labels and Spanish ordinal/cardinal references resolve against the exact persisted list revision.
  - Exactly one trusted position reaches `selectDisplayedFile`; provider IDs remain application-owned.
  - Duplicate, missing, reordered, refreshed, expired, or lease-lost snapshots produce guidance without selection effects.

- [x] **Happy path — search by name:**
  - User selects "None of these / search by name".
  - `searchSpreadsheets` called with user query.
  - Refined list presented and payload updated.

- [x] **Happy path — direct URL:**
  - User pastes a Google Drive URL.
  - `fileId` extracted and `validateFileAccess` returns `true`.
  - File selected and confirmed.
  - Payload includes `selectedFileId`, `selectedFileName`, and `provider`.
  - FSM transitions to `ONBOARDING_SHEET`.
  - `HandleSheetSelection` invoked automatically with empty `rawMessage`.

- [x] **Error path — access denied:**
  - `validateFileAccess` returns `false` on 403/404.
  - User informed of permission issues.

- [x] **Error path — no files found:**
  - `listRecentSpreadsheets` returns `[]`.
  - Clear message sent suggesting verification.
  - Manual name entry offered.

- [x] **Error path — invalid provider:**
  - `listRecentSpreadsheets` with `microsoft` throws `InvalidProviderError`.

- [x] **Error path — network failure:**
  - `fetch` throws network error.
  - `FileDiscoveryError` propagated with context.

- [x] **Error path — API error:**
  - Google Drive returns 401/500.
  - `FileDiscoveryError` thrown with HTTP status.

### OneDrive

- **Out of scope for MVP.** The use case returns a "coming soon" message for `microsoft` provider selections.
