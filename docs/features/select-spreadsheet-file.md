# Select Spreadsheet File

## Overview

The Select Spreadsheet File feature enables users to choose which spreadsheet file in their connected cloud storage account should receive their expense records. After completing the OAuth flow (Cloud Storage Connection), the bot enters the `ONBOARDING_FILE` state and guides the user through discovering, searching, and selecting a spreadsheet file.

## Scope

- **In scope:** Google Drive file discovery, search by name, direct URL validation, file selection, and access validation.
- **Out of scope:** OneDrive file discovery (MVP returns "coming soon"), sheet selection (handled by HU-4.03), column mapping (handled by HU-4.04).

## FSM States

| State              | Description                                                         | Next                                                                 |
| ------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `ONBOARDING_FILE`  | User is selecting a spreadsheet file from their cloud storage         | `ONBOARDING_SHEET` (file selected), self-transition (search / list)    |

## File Discovery Flow Sequence

### Initial Listing (`HandleSpreadsheetFileSelection`)

1. User enters `ONBOARDING_FILE` state after successful OAuth callback.
2. If `statePayload.fileList` is absent, `HandleSpreadsheetFileSelection` calls `CloudStoragePort.listRecentSpreadsheets`.
3. The adapter queries Google Drive API v3 for the 5 most recently modified spreadsheet files.
4. The use case formats a numbered list of files and appends a "None of these / search by name" option.
5. The file list is stored in the FSM payload via `TransitionConversationState`.
6. The user receives the formatted list message.

### Selection by Number

7. User replies with a number matching an item in `statePayload.fileList`.
8. The use case validates the choice and calls `CloudStoragePort.validateFileAccess` to confirm permissions.
9. A confirmation message with the full file name is sent via `MessagingOutputPort`.
10. The selected `fileId` and `fileName` are stored in the payload.
11. FSM transitions to `ONBOARDING_SHEET`.

### Search by Name

12. If the user chooses "None of these / search by name", the use case prompts for a file name.
13. When `statePayload.step === 'searching'`, the use case calls `CloudStoragePort.searchSpreadsheets` with the user's message as query.
14. A refined list is presented and the payload is updated.

### Direct URL Validation

15. If the user pastes a Google Drive or OneDrive URL, the use case extracts the `fileId`.
16. `CloudStoragePort.validateFileAccess` is called to verify permissions.
17. If accessible, the file is selected; if not, the user is informed of permission issues.

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

### Domain Port

#### `CloudStoragePort`

```ts
interface CloudStoragePort {
  listRecentSpreadsheets(accessToken: string, provider: SpreadsheetProvider): Promise<CloudFile[]>;
  searchSpreadsheets(accessToken: string, provider: SpreadsheetProvider, query: string): Promise<CloudFile[]>;
  validateFileAccess(fileId: string, accessToken: string, provider: SpreadsheetProvider): Promise<boolean>;
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

| Scenario                              | Behavior                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Invalid provider (`microsoft`)        | `InvalidProviderError` thrown by adapter.                                 |
| Network failure during discovery      | `FileDiscoveryError` thrown with network context.                         |
| Non-2xx HTTP from Google Drive API    | `FileDiscoveryError` thrown with HTTP status.                               |
| Invalid JSON response                 | `FileDiscoveryError` thrown.                                              |
| File access denied (403/404)          | `validateFileAccess` returns `false`; use case informs user.               |
| Unexpected HTTP during validation   | `FileDiscoveryError` thrown.                                              |

## QA Checklist

### Google Drive

- [ ] **Happy path — list recent files:**
  - User enters `ONBOARDING_FILE`.
  - `GoogleDriveFileDiscoveryAdapter` queries Drive API with correct mimeTypes, orderBy, pageSize, and fields.
  - Response mapped to `CloudFile[]` with correct `id`, `name`, `mimeType`, `modifiedAt`.
  - Numbered list (max 5 items) sent to user.
  - "None of these / search by name" option appended.
  - File list stored in `statePayload`.

- [ ] **Happy path — selection by number:**
  - User sends a number matching `statePayload.fileList`.
  - `validateFileAccess` returns `true`.
  - Confirmation message sent with full file name.
  - `selectedFileId` and `selectedFileName` stored in payload.
  - FSM transitions to `ONBOARDING_SHEET`.

- [ ] **Happy path — search by name:**
  - User selects "None of these / search by name".
  - `searchSpreadsheets` called with user query.
  - Refined list presented and payload updated.

- [ ] **Happy path — direct URL:**
  - User pastes a Google Drive URL.
  - `fileId` extracted and `validateFileAccess` returns `true`.
  - File selected and confirmed.

- [ ] **Error path — access denied:**
  - `validateFileAccess` returns `false` on 403/404.
  - User informed of permission issues.

- [ ] **Error path — no files found:**
  - `listRecentSpreadsheets` returns `[]`.
  - Clear message sent suggesting verification.
  - Manual name entry offered.

- [ ] **Error path — invalid provider:**
  - `listRecentSpreadsheets` with `microsoft` throws `InvalidProviderError`.

- [ ] **Error path — network failure:**
  - `fetch` throws network error.
  - `FileDiscoveryError` propagated with context.

- [ ] **Error path — API error:**
  - Google Drive returns 401/500.
  - `FileDiscoveryError` thrown with HTTP status.

### OneDrive

- **Out of scope for MVP.** The use case returns a "coming soon" message for `microsoft` provider selections.
