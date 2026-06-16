# Validate Spreadsheet Access

## Overview

Before the user can start recording expenses, the system must verify that it has both read and write permissions on the selected spreadsheet. This feature implements a proactive validation step that runs immediately after sheet selection (HU-4.03). If validation fails, the user receives a clear message explaining the problem and how to fix it, rather than discovering permission issues later when trying to save their first expense.

## Behavior (Implemented)

- **Read and write access confirmed (success):** The adapter reads the first 10 rows of the selected sheet and verifies write permissions via the provider's API. If both succeed, the flow continues transparently to column mapping (HU-4.05) without notifying the user.
- **Read-only access (read-only):** The adapter successfully reads the sheet but detects that write permissions are missing. Returns a structured result with a preview and a `read-only` kind.
- **Empty sheet (empty-sheet):** The adapter detects that the selected sheet contains no data. Returns a structured result with an `empty-sheet` kind.
- **Access error (access-error):** The adapter encounters a network failure, expired token, or permission error while attempting to read or verify permissions. Returns a structured result with an `access-error` kind, an error type (`network-error`, `token-expired`, `permission-denied`, or `unknown`), and a `retryable` flag.

## Behavior (TODO)

- **User-facing messages:** The Application layer use case (T-4.04-04) that translates these results into conversational messages is not yet implemented.
- **Retry logic:** The use case will implement automatic retry for `retryable: true` errors.
- **Empty sheet handling:** The use case will prompt the user to confirm whether the empty sheet is correct or to choose another.

## API / Interface

This feature does not expose HTTP endpoints. It is invoked internally by the Application layer after sheet selection.

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

No database changes. The validation is a transient check that does not persist state. The `spreadsheet_configs` table's `access_verified_at` field will be updated by the use case (T-4.04-04) upon successful validation.

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

## Related User Stories

- **HU-4.04:** Read and validate spreadsheet access
- **HU-4.03:** Select sheet (predecessor)
- **HU-4.05:** Column mapping (successor)

## Notes

- The validation is transparent to the user when successful — no message is sent.
- The `SpreadsheetPreview` includes the first 10 rows, which may be used by the column mapping use case (HU-4.05) to infer column roles.
- Both adapters use direct `fetch` calls rather than SDK dependencies (`googleapis`, `@microsoft/microsoft-graph-client`) to keep the dependency surface minimal.
- The `retryable` flag in `access-error` results is always `true` for network and token errors, allowing the use case to implement automatic retry logic.
