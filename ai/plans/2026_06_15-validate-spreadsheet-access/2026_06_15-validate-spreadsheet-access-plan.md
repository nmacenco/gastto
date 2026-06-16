# Plan: Implement spreadsheet access validation (HU-4.04 T-4.04-01 / 02 / 03)

## Goal

Define the domain contract for validating spreadsheet read/write access and implement it for both Google Sheets and Excel Online, so the application use case (T-4.04-04) can verify access transparently before column mapping.

## Context

- `src/domain/ports/services.ts` already defines `SpreadsheetPort` with an unimplemented `validateAccess(fileId, sheetName): Promise<boolean>`. This plan leaves that interface unchanged.
- `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts` exists and uses direct `fetch` to Google Sheets API v4.
- No Excel Online sheet adapter exists; `@microsoft/microsoft-graph-client` is installed but unused for sheets.
- Existing adapter tests mock `globalThis.fetch`.
- Feature docs live in `docs/features/` and must be kept in sync per `AGENTS.md`.
- ADR-004 establishes the Adapter Pattern for spreadsheets and the proactive permission verification principle.
- The project stack is TypeScript, Fastify, Vitest, Drizzle ORM, and pnpm.

## Public contracts

| Contract | Type | Details |
|---|---|---|
| `ValidateSpreadsheetAccessPort` | Domain port | New file `src/domain/ports/spreadsheetAccess.ts`. Method: `validateSpreadsheetAccess(fileId: string, sheetName: string): Promise<SpreadsheetAccessResult>`. |
| `SpreadsheetPreview` | Domain entity | New file `src/domain/entities/SpreadsheetPreview.ts`. Props: `provider`, `fileId`, `sheetName`, `rows: Row[]`. |
| `SpreadsheetAccessResult` | Domain value object | New file `src/domain/value-objects/SpreadsheetAccessResult.ts`. Discriminated union covering `success`, `read-only`, `empty-sheet`, and `access-error`. |
| `SpreadsheetAccessErrorType` | Type alias | `'network-error' \| 'token-expired' \| 'permission-denied' \| 'unknown'`. |
| `GoogleSheetsAdapter` | Infrastructure adapter | Adds `ValidateSpreadsheetAccessPort` implementation. |
| `ExcelOnlineAdapter` | Infrastructure adapter | New file implementing `SpreadsheetPort` + `ValidateSpreadsheetAccessPort`. |

### Proposed `SpreadsheetAccessResult` shape

```ts
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

## Phases

### Phase 1 — Domain contracts

- [x] Create `src/domain/ports/spreadsheetAccess.ts` with `ValidateSpreadsheetAccessPort`.
- [x] Create `src/domain/entities/SpreadsheetPreview.ts` with constructor validation.
- [x] Create `src/domain/value-objects/SpreadsheetAccessResult.ts` with the discriminated union.
- [x] Export new contracts from `src/domain/ports/index.ts` and `src/domain/value-objects/index.ts`.
- [x] Add unit tests for `SpreadsheetPreview` construction and all `SpreadsheetAccessResult` variants.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2 — Google Sheets adapter

- [ ] Implement `ValidateSpreadsheetAccessPort` in `GoogleSheetsAdapter`.
- [ ] Read first 10 rows via `GET https://sheets.googleapis.com/v4/spreadsheets/{fileId}/values/{sheetName}!1:10`.
- [ ] Detect empty sheet when `values` is missing or empty.
- [ ] Verify write permission via Drive API `GET https://www.googleapis.com/drive/v3/files/{fileId}?fields=capabilities(canEdit)`.
- [ ] Map outcomes to `SpreadsheetAccessResult`:
  - Read OK + can edit → `success`
  - Read OK + cannot edit → `read-only`
  - Empty sheet → `empty-sheet`
  - Network failure → `access-error/network-error/retryable: true`
  - HTTP 401 → `access-error/token-expired/retryable: true`
  - HTTP 403 → `access-error/permission-denied/retryable: true`
  - Other API failures → `access-error/unknown/retryable: true`
- [ ] Extend `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.spec.ts` with mocked `fetch` scenarios covering all four result variants.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3 — Excel Online adapter and docs

- [ ] Create `src/infrastructure/adapters/sheets/ExcelOnlineAdapter.ts`.
- [ ] Implement `SpreadsheetPort` methods with `SpreadsheetError('not yet implemented')` for methods outside this HU.
- [ ] Implement `ValidateSpreadsheetAccessPort`:
  - Read first 10 rows via Microsoft Graph `GET https://graph.microsoft.com/v1.0/me/drive/items/{fileId}/workbook/worksheets/{sheetName}/range(address='A1:J10')`.
  - Detect empty sheet when `values` is missing or empty.
  - Verify write permission via `GET https://graph.microsoft.com/v1.0/me/drive/items/{fileId}?$select=capabilities` and check `capabilities.canEdit`.
  - Map errors to the same `SpreadsheetAccessResult` taxonomy used by Google.
- [ ] Create `src/infrastructure/adapters/sheets/ExcelOnlineAdapter.spec.ts` with mocked `fetch` covering all four result variants.
- [ ] Create `src/infrastructure/adapters/sheets/index.ts` exporting both adapters.
- [ ] Create `docs/features/validate-spreadsheet-access.md` documenting the port, value objects, adapters, and error taxonomy.
- [ ] Update `docs/features/README.md` index.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Execute Phase 2 — Google Sheets adapter: implement `ValidateSpreadsheetAccessPort` in `GoogleSheetsAdapter` with preview reading, empty-sheet detection, Drive API capability check, and error mapping.
