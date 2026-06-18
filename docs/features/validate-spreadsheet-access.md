# Validate Spreadsheet Access

## Overview

Before the user can start recording expenses, the system must verify that it has both read and write permissions on the selected spreadsheet. This feature implements a proactive validation step that runs immediately after sheet selection (HU-4.03). If validation fails, the user receives a clear message explaining the problem and how to fix it, rather than discovering permission issues later when trying to save their first expense.

## Behavior (Implemented)

- **Read and write access confirmed (success):** The adapter reads the first 10 rows of the selected sheet and verifies write permissions via the provider's API. If both succeed, the flow continues transparently to column mapping (HU-4.05) without notifying the user. The `SpreadsheetPreview` is serialized and stored in the FSM state payload so that `InferColumnMapping` can extract headers and sample rows without re-reading the sheet.
- **Read-only access (read-only):** The adapter successfully reads the sheet but detects that write permissions are missing. Returns a structured result with a preview and a `read-only` kind. The use case sends a message explaining how to fix permissions in Google Drive or OneDrive, and stays in `ONBOARDING_VALIDATING_ACCESS` so the user can retry.
- **Empty sheet (empty-sheet):** The adapter detects that the selected sheet contains no data. Returns a structured result with an `empty-sheet` kind. The use case asks the user to confirm the sheet or choose another, transitioning to `ONBOARDING_SHEET` with `step: 'empty-sheet-confirm'`. If the user confirms, an out-of-MVP message is sent. If they choose another sheet, the selection flow is re-invoked.
- **Access error (access-error):** The adapter encounters a network failure, expired token, or permission error while attempting to read or verify permissions. Returns a structured result with an `access-error` kind, an error type (`network-error`, `token-expired`, `permission-denied`, or `unknown`), and a `retryable` flag. The use case automatically retries once for `retryable: true` errors. If the retry fails, or if the error is non-retryable, a reconnect-account message is sent and the FSM transitions to `ONBOARDING_START`.
- **Token errors:** Missing, expired, revoked, or undecryptable tokens trigger the reconnect-account message and transition to `ONBOARDING_START`.

## API / Interface

This feature does not expose HTTP endpoints. It is invoked internally by the Application layer after sheet selection via the `ValidateSpreadsheetAccess` use case, which is routed by the FSM state `ONBOARDING_VALIDATING_ACCESS` in `message.worker.ts`.

### Application Use Case

```typescript
// src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts
export class ValidateSpreadsheetAccess {
  async execute(input: ValidateSpreadsheetAccessInput): Promise<ValidateSpreadsheetAccessOutput>;
}
```

The use case:
1. Resolves the provider and retrieves/decrypts the OAuth token.
2. Creates the appropriate port via `ValidateSpreadsheetAccessPortFactory`.
3. Calls `validateSpreadsheetAccess(fileId, sheetName)`.
4. On `access-error` with `retryable: true`, retries once automatically.
5. Translates the result into the appropriate FSM transition and user-facing message.

### Domain Port

```typescript
// src/domain/ports/spreadsheetAccess.ts
export interface ValidateSpreadsheetAccessPort {
  validateSpreadsheetAccess(
    fileId: string,
    sheetName: string,
  ): Promise<SpreadsheetAccessResult>;
}
```

### Domain Value Objects

```typescript
// src/domain/value-objects/SpreadsheetAccessResult.ts
export type SpreadsheetAccessErrorType =
  | 'network-error'
  | 'token-expired'
  | 'permission-denied'
  | 'unknown';

export type SpreadsheetAccessResult =
  | { kind: 'success'; preview: SpreadsheetPreview }
  | { kind: 'read-only'; preview: SpreadsheetPreview }
  | { kind: 'empty-sheet' }
  | { kind: 'access-error'; errorType: SpreadsheetAccessErrorType; retryable: boolean };
```

```typescript
// src/domain/entities/SpreadsheetPreview.ts
export class SpreadsheetPreview {
  readonly provider: SpreadsheetProvider;
  readonly fileId: string;
  readonly sheetName: string;
  readonly rows: readonly Row[];
}
```

### Infrastructure Adapters

- **GoogleSheetsAdapter:** Implements `ValidateSpreadsheetAccessPort` using Google Sheets API v4 to read rows and Google Drive API v3 to check `capabilities.canEdit`.
- **ExcelOnlineAdapter:** Implements `ValidateSpreadsheetAccessPort` using Microsoft Graph API to read rows and check `capabilities.canEdit` on the drive item.

## Data Model

The validation updates the `spreadsheet_configs.access_verified_at` field upon successful validation. The FSM adds a new state `ONBOARDING_VALIDATING_ACCESS` which transitions to `ONBOARDING_MAPPING` on success, `ONBOARDING_SHEET` on empty-sheet, and `ONBOARDING_START` on persistent errors.

## Tests

### GoogleSheetsAdapter

- [x] Returns `success` when read and write permissions are confirmed
- [x] Returns `read-only` when write permission is denied
- [x] Returns `empty-sheet` when sheet has no content
- [x] Returns `empty-sheet` when values array is empty
- [x] Returns `access-error` with `network-error` on fetch failure
- [x] Returns `access-error` with `token-expired` on 401 from Sheets API
- [x] Returns `access-error` with `permission-denied` on 403 from Sheets API
- [x] Returns `access-error` with `unknown` on other HTTP errors from Sheets API
- [x] Returns `access-error` with `network-error` on fetch failure during capability check
- [x] Returns `access-error` with `token-expired` on 401 from Drive API
- [x] Returns `access-error` with `permission-denied` on 403 from Drive API
- [x] Returns `access-error` with `unknown` on other HTTP errors from Drive API
- [x] Returns `read-only` when `capabilities.canEdit` is missing
- [x] Encodes sheet name with special characters

### ExcelOnlineAdapter

- [x] Returns `success` when read and write permissions are confirmed
- [x] Returns `read-only` when write permission is denied
- [x] Returns `empty-sheet` when sheet has no content
- [x] Returns `empty-sheet` when values array is empty
- [x] Returns `access-error` with `network-error` on fetch failure
- [x] Returns `access-error` with `token-expired` on 401 from Graph API
- [x] Returns `access-error` with `permission-denied` on 403 from Graph API
- [x] Returns `access-error` with `unknown` on other HTTP errors from Graph API
- [x] Returns `access-error` with `network-error` on fetch failure during capability check
- [x] Returns `access-error` with `token-expired` on 401 from capability check
- [x] Returns `access-error` with `permission-denied` on 403 from capability check
- [x] Returns `access-error` with `unknown` on other HTTP errors from capability check
- [x] Returns `read-only` when `capabilities.canEdit` is missing
- [x] Encodes sheet name with special characters

### SpreadsheetPreview

- [x] Creates a valid SpreadsheetPreview with all required fields
- [x] Accepts `microsoft` as provider
- [x] Trims whitespace from fileId and sheetName
- [x] Allows empty rows array
- [x] Throws DomainValidationError when provider is invalid
- [x] Throws DomainValidationError when fileId is empty
- [x] Throws DomainValidationError when fileId is whitespace only
- [x] Throws DomainValidationError when sheetName is empty
- [x] Throws DomainValidationError when rows is not an array
- [x] Throws when attempting to mutate properties at runtime
- [x] Returns true/false for equality comparisons

### SpreadsheetAccessResult

- [x] All four variants compile and have correct shape
- [x] Discriminated union narrowing works correctly

### ValidateSpreadsheetAccess use case

- [x] Updates `accessVerifiedAt`, transitions to `ONBOARDING_MAPPING`, and sends no message on success
- [x] Sends read-only warning and stays in `ONBOARDING_VALIDATING_ACCESS` on read-only
- [x] Sends empty-sheet confirm, transitions to `ONBOARDING_SHEET` with step and sheetList on empty-sheet
- [x] Omits sheetList from payload when not present in statePayload on empty-sheet
- [x] Retries once automatically when retryable and succeeds on retry
- [x] Sends reconnect message and transitions to `ONBOARDING_START` when retry also fails
- [x] Does not retry when error is not retryable
- [x] Sends reconnect message and transitions to `ONBOARDING_START` when token is missing
- [x] Sends reconnect message and transitions to `ONBOARDING_START` when token is expired
- [x] Sends reconnect message and transitions to `ONBOARDING_START` when token is revoked
- [x] Sends reconnect message and transitions to `ONBOARDING_START` when decryption fails
- [x] Sends reconnect message when fileId is missing
- [x] Sends reconnect message when sheetName is missing
- [x] Sends coming soon message and stays in `ONBOARDING_VALIDATING_ACCESS` for microsoft provider

### HandleSheetSelection (empty-sheet-confirm step)

- [x] Sends out-of-MVP message when user confirms with "sí"
- [x] Sends out-of-MVP message when user confirms with "si"
- [x] Sends out-of-MVP message when user confirms with "dale"
- [x] Treats non-confirm input as sheet selection by number
- [x] Treats non-confirm input as sheet selection by name
- [x] Re-prompts when selection is invalid
- [x] Returns connection failed when token is missing
- [x] Returns connection failed when sheetList is missing

### Intents utility

- [x] `isConfirmIntent` returns true for all confirm words (sí, si, ok, dale, etc.)
- [x] `isConfirmIntent` handles trailing text, whitespace, and uppercase
- [x] `isConfirmIntent` returns false for non-confirm words and partial matches
- [x] `isCancelIntent` returns true for all cancel words (no, cancelar, etc.)
- [x] `isCancelIntent` handles trailing text, whitespace, and uppercase
- [x] `isCancelIntent` returns false for non-cancel words

## Related User Stories

- **HU-4.04:** Read and validate spreadsheet access
- **HU-4.03:** Select sheet (predecessor)
- **HU-4.05:** Column mapping (successor)

## Notes

- The validation is transparent to the user when successful — no message is sent.
- The `SpreadsheetPreview` includes the first 10 rows, which may be used by the column mapping use case (HU-4.05) to infer column roles.
- Both adapters use direct `fetch` calls rather than SDK dependencies (`googleapis`, `@microsoft/microsoft-graph-client`) to keep the dependency surface minimal.
- The `retryable` flag in `access-error` results is always `true` for network and token errors, allowing the use case to implement automatic retry logic.
