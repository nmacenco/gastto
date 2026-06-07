# Plan: Implement Google Drive file discovery adapter

## Goal

Implement the `GoogleDriveFileDiscoveryAdapter` in the Infrastructure layer that satisfies the `CloudStoragePort` domain interface. Use direct `fetch` calls to Google Drive API v3 to list recent spreadsheets, search by name, and validate file access. Map responses to the `CloudFile` value object and errors to `FileDiscoveryError` or `FileAccessDeniedError`. Include unit tests with mocked `fetch`.

## Context

- Existing contracts delivered in T-4.02-01:
  - `src/domain/ports/cloudStorage.ts` - `CloudStoragePort` interface.
  - `src/domain/entities/CloudFile.ts` - immutable value object.
  - `src/domain/errors/FileDiscoveryError.ts` and `FileAccessDeniedError.ts`.
  - `src/domain/errors/InvalidProviderError.ts`.
- Reference pattern for direct `fetch` and test mocking:
  - `src/infrastructure/adapters/oauth/GoogleDriveOAuthAdapter.ts`
  - `src/infrastructure/adapters/oauth/GoogleDriveOAuthAdapter.spec.ts`
- Target files:
  - `src/infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter.ts`
  - `src/infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter.spec.ts`
  - `src/infrastructure/adapters/drive/index.ts` (barrel export)

## Public contracts

| Type | Phase | Details |
|------|-------|---------|
| Application service | 1 | `GoogleDriveFileDiscoveryAdapter` - `listRecentSpreadsheets`, `searchSpreadsheets`, `validateFileAccess` |
| Test suite | 1 | `GoogleDriveFileDiscoveryAdapter.spec.ts` - happy path, empty results, invalid provider, access denied, network failure, invalid JSON |

## Phases

### Phase 1: Implement adapter and contract tests

- [x] Create `src/infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter.ts` implementing `CloudStoragePort`:
  - `listRecentSpreadsheets(accessToken, provider)`:
    - Query `https://www.googleapis.com/drive/v3/files` with `q` filtering spreadsheet mimeTypes (`application/vnd.google-apps.spreadsheet`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.oasis.opendocument.spreadsheet`), `orderBy=modifiedTime desc`, `pageSize=5`, `fields=files(id,name,mimeType,modifiedTime)`.
    - Pass `accessToken` via `Authorization: Bearer` header.
    - Throw `InvalidProviderError` if provider is not `'google'`.
    - Map response items to `CloudFile[]`.
    - Throw `FileDiscoveryError` on non-2xx HTTP, invalid JSON, or network failure.
  - `searchSpreadsheets(accessToken, provider, query)`:
    - Same as above but append `and name contains '{query}'` to the `q` parameter.
    - Throw `InvalidProviderError` for non-Google providers.
    - Map errors to `FileDiscoveryError`.
  - `validateFileAccess(fileId, accessToken, provider)`:
    - Perform `files.get` with the given `fileId`.
    - Return `true` on HTTP 200, `false` on HTTP 403/404.
    - Throw `InvalidProviderError` for non-Google providers.
    - Throw `FileDiscoveryError` on other non-2xx HTTP responses or network failures.
- [x] Create `src/infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter.spec.ts` with mocked `fetch` tests covering:
  - `listRecentSpreadsheets` happy path returning `CloudFile[]`.
  - `listRecentSpreadsheets` empty results returning `[]`.
  - `listRecentSpreadsheets` throws `InvalidProviderError` for `microsoft`.
  - `listRecentSpreadsheets` throws `FileDiscoveryError` on non-2xx HTTP.
  - `listRecentSpreadsheets` throws `FileDiscoveryError` on invalid JSON.
  - `listRecentSpreadsheets` throws `FileDiscoveryError` on network failure.
  - `searchSpreadsheets` happy path with query.
  - `searchSpreadsheets` throws `InvalidProviderError` for `microsoft`.
  - `validateFileAccess` returns `true` on HTTP 200.
  - `validateFileAccess` returns `false` on HTTP 403 and 404.
  - `validateFileAccess` throws `InvalidProviderError` for `microsoft`.
  - `validateFileAccess` throws `FileDiscoveryError` on unexpected HTTP errors.
  - `validateFileAccess` throws `FileDiscoveryError` on network failure.
- [x] Create `src/infrastructure/adapters/drive/index.ts` as barrel export.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Create `docs/features/select-spreadsheet-file.md` as canonical feature documentation.
- [x] Update `docs/features/README.md` to include the new feature in the index.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Phase 1 is complete. All acceptance criteria for T-4.02-02 have been satisfied.
