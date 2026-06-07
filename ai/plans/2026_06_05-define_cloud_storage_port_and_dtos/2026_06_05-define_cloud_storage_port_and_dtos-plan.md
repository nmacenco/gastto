# Plan: Define CloudStorage file discovery port and DTOs

**Goal:** Create the `CloudStoragePort` interface, `CloudFile` value object, and `FileDiscoveryError` / `FileAccessDeniedError` domain errors so the Application layer can list, search, and validate spreadsheet files without coupling to Google Drive specifics.

---

## Context

- **Architecture:** Clean Architecture (ADR-001). Domain layer must not import external libraries.
- **Existing patterns to follow:**
  - Value objects: `src/domain/value-objects/IncomingMessage.ts` (immutable, validation at construction, `Object.freeze`, `equals` method).
  - Ports: `src/domain/ports/services.ts` (`SpreadsheetPort`) and `src/domain/ports/oauth.ts` (`OAuthServicePort`) — plain interfaces.
  - Errors: `src/domain/errors/OAuthDeniedError.ts` — standalone class extending `Error` directly.
  - Barrel exports: `src/domain/ports/index.ts`.
- **Reused type:** `SpreadsheetProvider` from `src/domain/entities/SpreadsheetConfig.ts`.
- **Files to create/modify:**
  - `src/domain/entities/CloudFile.ts`
  - `src/domain/ports/cloudStorage.ts`
  - `src/domain/ports/index.ts`
  - `src/domain/errors/FileDiscoveryError.ts`
  - `src/domain/errors/FileAccessDeniedError.ts`
  - `src/domain/entities/CloudFile.spec.ts`
- **Docs to consider:** `docs/testing/guidelines.md` (domain tests: pure TS, zero mocks, test construction/validation/equality).

---

## Phases

### Phase 1: Define core contracts (CloudFile + CloudStoragePort)

- [x] Create `src/domain/entities/CloudFile.ts` with `CloudFile` class:
  - Fields: `id: string`, `name: string`, `mimeType: string`, `modifiedAt: Date`.
  - Immutable (`Object.freeze`), validation at construction, `equals` method.
- [x] Create `src/domain/ports/cloudStorage.ts` with `CloudStoragePort` interface:
  - `listRecentSpreadsheets(accessToken: string, provider: SpreadsheetProvider): Promise<CloudFile[]>`
  - `searchSpreadsheets(accessToken: string, provider: SpreadsheetProvider, query: string): Promise<CloudFile[]>`
  - `validateFileAccess(fileId: string, accessToken: string, provider: SpreadsheetProvider): Promise<boolean>`
- [x] Update `src/domain/ports/index.ts` to re-export from `./cloudStorage`.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Add domain errors, tests, and build verification

- [x] Create `src/domain/errors/FileDiscoveryError.ts` following the `OAuthDeniedError` pattern.
- [x] Create `src/domain/errors/FileAccessDeniedError.ts` following the `OAuthDeniedError` pattern.
- [x] Create `src/domain/entities/CloudFile.spec.ts` with Vitest unit tests:
  - Construction with valid fields.
  - Validation errors for empty/missing fields.
  - Immutability at runtime.
  - Equality comparison.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

---

## Next step

All phases complete. The plan is fully implemented. Proceed to close the loop on the task file by checking off acceptance criteria in `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.02-select-the-spreadsheet-file/tasks/T-4.02-01.md`.

---

## Public contracts created

| Contract Type     | Phase | Details                                                                                   |
| ----------------- | ----- | ----------------------------------------------------------------------------------------- |
| **Value Object**  | 1     | `CloudFile` — `id`, `name`, `mimeType`, `modifiedAt`                                      |
| **Domain Port**   | 1     | `CloudStoragePort` — `listRecentSpreadsheets`, `searchSpreadsheets`, `validateFileAccess` |
| **Domain Errors** | 2     | `FileDiscoveryError`, `FileAccessDeniedError`                                             |
| **Test Suite**    | 2     | `CloudFile.spec.ts` — construction, validation, immutability, equality                    |
