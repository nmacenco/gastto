# Select Sheet

## Overview

The Select Sheet feature enables users to choose which sheet within their selected spreadsheet file contains their expense records. After completing the file selection (Select Spreadsheet File), the bot enters the `ONBOARDING_SHEET` state and guides the user through discovering available sheets, choosing by number or name, or receiving a header-based description of each sheet when they are unsure.

## Scope

- **In scope:** Google Sheets sheet discovery via `listSheets`, single-sheet auto-confirmation, multi-sheet selection by number or fuzzy name match, "I don't know" header description flow, invalid name re-prompt, and spreadsheet config persistence.
- **Out of scope:** OneDrive sheet selection (MVP returns "coming soon"), column mapping (handled by HU-4.04), read/write access verification (handled by HU-4.04).

## FSM States

| State             | Description                                          | Next                                                                |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| `ONBOARDING_SHEET` | User is selecting a sheet within the chosen file    | `ONBOARDING_MAPPING` (sheet confirmed), self-transition (re-prompt) |

## Flow Sequence

### Initial Listing (`HandleSheetSelection`)

1. User enters `ONBOARDING_SHEET` state after selecting a file in `ONBOARDING_FILE`.
2. `HandleSheetSelection` can be triggered in two ways:
   - Automatically: `HandleSpreadsheetFileSelection` invokes it with an empty `rawMessage` immediately after transitioning to `ONBOARDING_SHEET`.
   - Manually: the next incoming message in `ONBOARDING_SHEET` is routed by `message.worker` when automatic discovery did not run or when the user is selecting from an already-displayed list.
3. `HandleSheetSelection` retrieves the OAuth token via `IOAuthTokenRepository` and decrypts it via `TokenEncryptionPort`.
4. `SpreadsheetPortFactory` creates a `GoogleSheetsAdapter` with the decrypted token.
5. `listSheets(fileId)` queries the Google Sheets API v4 metadata endpoint.
6. If the file has **one sheet**, the use case auto-confirms, persists the config, and transitions to `ONBOARDING_MAPPING`.
7. If the file has **multiple sheets**, the use case formats a numbered list and sends it via `MessagingOutputPort`.
8. The sheet list is stored in the FSM payload via `TransitionConversationState`.

### Selection by Number

8. User replies with a number matching the sheet list.
9. The use case validates that `1 <= choice <= sheetList.length`.
10. On valid choice: `ISpreadsheetConfigRepository.create` persists the config with `sheetName`, `fileId`, `fileName`, and a placeholder `accessVerifiedAt`.
11. A confirmation message is sent via `MessagingOutputPort`.
12. FSM transitions to `ONBOARDING_MAPPING`.
13. On invalid number (e.g. `0`, `99`): the user is re-prompted with the sheet list.

### Selection by Name (Fuzzy Matching)

14. User types the exact or near-exact name of a sheet.
15. The input is normalized: lowercase, NFD unaccented, whitespace collapsed.
16. The normalized input is compared against each sheet name using the same normalization.
17. On match: the sheet is confirmed, config persisted, and FSM transitions to `ONBOARDING_MAPPING`.
18. On mismatch: the user is re-prompted with the sheet list.

### "I Don't Know" Header Description

19. User sends an IDK variant (e.g. "no sé", "ni idea", "no tengo idea" — 18+ variants).
20. The use case calls `getHeaders(fileId, sheetName)` for each sheet in the list.
21. A formatted description of each sheet's columns is sent to the user.
22. The FSM payload is updated with `step: 'idk'` to track the user's state.
23. The user remains in `ONBOARDING_SHEET` to reply with a number or name.

### Invalid Name

24. If the user sends a message that does not match any sheet name, number, or IDK variant, the use case re-prompts with the full sheet list.

## Adapters

- `GoogleSheetsAdapter` — direct `fetch` calls to Google Sheets API v4. No `googleapis` SDK dependency.
- `SpreadsheetPort` — Domain interface that decouples the Application layer from Google Sheets specifics.
- `DrizzleSpreadsheetConfigRepository` — Drizzle ORM implementation of `ISpreadsheetConfigRepository` for persisting `spreadsheet_configs` records.

## Configuration

No additional environment variables are required. The adapter uses the same OAuth `accessToken` retrieved from the token repository during the `HandleSheetSelection` use case.

## API Contracts

### Application DTOs

#### `HandleSheetSelectionInput`

```ts
interface HandleSheetSelectionInput {
  userId: string;
  rawMessage: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}
```

#### `HandleSheetSelectionOutput`

```ts
interface HandleSheetSelectionOutput {
  nextState: FsmState;
  message: string;
  payload?: Record<string, unknown>;
}
```

#### `HandleSheetSelectionDeps`

```ts
interface HandleSheetSelectionDeps {
  spreadsheetPortFactory: SpreadsheetPortFactory;
  tokenRepository: IOAuthTokenRepository;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  tokenEncryption: TokenEncryptionPort;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
}
```

### Domain Port

#### `SpreadsheetPort`

```ts
interface SpreadsheetPort {
  readRows(fileId: string, range: string): Promise<Row[]>;
  appendRow(fileId: string, sheetName: string, values: CellValue[]): Promise<AppendResult>;
  deleteRow(fileId: string, sheetName: string, rowIndex: number): Promise<void>;
  getUniqueValues(fileId: string, columnIndex: number, sheetName: string): Promise<string[]>;
  getHeaders(fileId: string, sheetName: string): Promise<string[]>;
  listSheets(fileId: string): Promise<SheetInfo[]>;
  validateAccess(fileId: string, sheetName: string): Promise<boolean>;
}
```

#### `SheetInfo` Value Object

```ts
class SheetInfo {
  readonly name: string;
  readonly index: number;
  constructor(props: { name: string; index: number });
  equals(other: SheetInfo): boolean;
}
```

#### `ISpreadsheetConfigRepository`

```ts
interface ISpreadsheetConfigRepository {
  findByUserId(userId: string): Promise<SpreadsheetConfig | null>;
  create(config: Omit<SpreadsheetConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<SpreadsheetConfig>;
  updateAccessVerified(id: string): Promise<void>;
}
```

## Error Handling

| Scenario                           | Behavior                                                     |
| ---------------------------------- | ------------------------------------------------------------ |
| Invalid provider (`microsoft`)     | `comingSoon` message returned; stays in `ONBOARDING_SHEET`.  |
| Missing OAuth token                | `reconnectAccount` message sent; transitions to `ONBOARDING_START`. |
| Expired / revoked token            | `reconnectAccount` message sent; transitions to `ONBOARDING_START`. |
| Token decryption failure           | `reconnectAccount` message sent; transitions to `ONBOARDING_START`. |
| Missing `fileId` in statePayload   | `fileAccessFailed` message returned; stays in `ONBOARDING_SHEET`. |
| Network failure during `listSheets`| `SpreadsheetError` thrown; `sheetDiscoveryFailed` returned. |
| Non-2xx HTTP from Sheets API       | `SpreadsheetError` thrown with HTTP status; error message returned. |
| Invalid JSON response              | `SpreadsheetError` thrown; `sheetDiscoveryFailed` returned. |
| Empty sheet list (0 sheets)        | Error message sent; no state transition.                     |
| Invalid selection number (0, 99)   | Re-prompt with sheet list; stays in `ONBOARDING_SHEET`.      |
| Invalid name (no fuzzy match)      | Re-prompt with sheet list; stays in `ONBOARDING_SHEET`.      |

## QA Checklist

### Google Sheets

- [x] **Happy path — single sheet auto-confirm:**
  - File has 1 sheet.
  - `HandleSheetSelection` triggered automatically from `HandleSpreadsheetFileSelection` with empty `rawMessage`.
  - `listSheets` returns array with 1 item.
  - `ISpreadsheetConfigRepository.create` called with `sheetName`, placeholder `accessVerifiedAt`.
  - Confirmation message sent.
  - FSM transitions to `ONBOARDING_MAPPING`.

- [x] **Happy path — multi-sheet list:**
  - File has 3 sheets.
  - `HandleSheetSelection` triggered automatically from `HandleSpreadsheetFileSelection` with empty `rawMessage`.
  - `listSheets` returns array with 3 items.
  - Numbered list sent to user.
  - "No sé / ninguna de estas" option appended.
  - Sheet list stored in `statePayload`.

- [x] **Happy path — selection by number:**
  - User sends "2".
  - Choice validated against `sheetList.length`.
  - Config persisted with correct `sheetName`.
  - FSM transitions to `ONBOARDING_MAPPING`.

- [x] **Happy path — selection by name (exact):**
  - User sends "Resumen".
  - Fuzzy match succeeds with exact name.
  - Config persisted.
  - FSM transitions to `ONBOARDING_MAPPING`.

- [x] **Happy path — selection by name (accent normalization):**
  - User sends "resumen" (lowercase, no accent).
  - Matches "Resumen" after normalization.
  - Config persisted.

- [x] **Happy path — "I don't know" header description:**
  - User sends "no sé".
  - `getHeaders` called for each sheet.
  - Formatted description sent with column names.
  - `statePayload.step` set to `'idk'`.
  - User stays in `ONBOARDING_SHEET`.

- [x] **Error path — invalid selection number:**
  - User sends "0" or "99".
  - Re-prompt with full sheet list.
  - No config created.

- [x] **Error path — invalid name:**
  - User sends "hoja inexistente".
  - No fuzzy match found.
  - Re-prompt with full sheet list.

- [x] **Error path — missing token:**
  - `findByUserAndProvider` returns `null`.
  - `reconnectAccount` message sent.
  - FSM transitions to `ONBOARDING_START`.

- [x] **Error path — expired token:**
  - `accessTokenExpiresAt` is in the past.
  - `reconnectAccount` message sent.
  - FSM transitions to `ONBOARDING_START`.

- [x] **Error path — revoked token:**
  - `revokedAt` is set.
  - `reconnectAccount` message sent.
  - FSM transitions to `ONBOARDING_START`.

- [x] **Error path — token decryption failure:**
  - `decrypt` throws.
  - `reconnectAccount` message sent.
  - FSM transitions to `ONBOARDING_START`.

- [x] **Error path — missing fileId:**
  - `statePayload` lacks `selectedFileId`.
  - `fileAccessFailed` message sent.
  - `listSheets` not called.

- [x] **Error path — network failure during listSheets:**
  - `fetch` throws network error.
  - `SpreadsheetError` propagated.
  - `sheetDiscoveryFailed` message sent.

- [x] **Error path — API error during listSheets:**
  - Google Sheets returns 403/500.
  - `SpreadsheetError` thrown with HTTP status.
  - Error message returned to user.

- [x] **Error path — API error during getHeaders:**
  - Google Sheets returns 404 during IDK flow.
  - `SpreadsheetError` thrown with HTTP status.
  - Error message returned to user.

- [x] **Error path — empty sheet list:**
  - File has 0 sheets.
  - Error message sent.
  - No state transition.

### OneDrive

- **Out of scope for MVP.** The use case returns a "coming soon" message for `microsoft` provider selections.
