# Plan: Implement HandleSpreadsheetFileSelection use case

## Goal

Implement the `HandleSpreadsheetFileSelection` Application use case that orchestrates the entire `ONBOARDING_FILE` state. It retrieves and decrypts the user's OAuth token, calls `CloudStoragePort` to list, search, or validate spreadsheet files, handles all user reply variants (number selection, name search, direct URL, or "none of these"), stores the selected file in the FSM payload, and transitions to `ONBOARDING_SHEET`.

## Context

- **Architecture:** Clean Architecture (ADR-001). The Application layer owns all business logic; the worker/route only deserializes and delegates.
- **Existing patterns to follow:**
  - `src/application/use-cases/spreadsheet/HandleOAuthCallback.ts` — use case structure with `Deps` interface, error handling, and `TransitionConversationState`.
  - `src/application/use-cases/spreadsheet/InitiateCloudConnection.ts` — input/output DTO pattern, copies usage.
  - `src/application/use-cases/conversation/TransitionConversationState.ts` — FSM payload persistence pattern.
- **Ports and contracts already delivered:**
  - `src/domain/ports/cloudStorage.ts` — `CloudStoragePort` (T-4.02-01, done).
  - `src/infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter.ts` — adapter implementation (T-4.02-02, done).
  - `src/application/ports/output/messaging.port.ts` — `MessagingOutputPort`.
- **Contracts to extend for this task:**
  - `src/domain/ports/tokenEncryption.ts` — currently only has `encrypt`. Needs `decrypt` so the use case can read the stored access token.
  - `src/infrastructure/security/TokenEncryptionAdapter.ts` — needs `decrypt` implementation (wrapper over existing `aes256gcm.decrypt`).
- **Prerequisite fix in existing code:** `HandleOAuthCallback` currently transitions to `ONBOARDING_FILE` without passing the `provider` in the payload. The use case needs this to call `CloudStoragePort` and query `IOAuthTokenRepository`. A minimal 2-line fix plus updating the unit test expectation is included in Phase 1.
- **Copies:** `src/application/copies/onboarding.copies.ts` needs file-selection text strings. Since T-4.02-05 (copies) is a delivery dependency blocking the merge, these copies will be added as part of this plan to ensure the use case is complete and testable.
- **Feature doc:** `docs/features/select-spreadsheet-file.md` defines the full flow and acceptance criteria.

## Public Contracts

| Contract Type              | Phase | Details                                                                                                                                                                                      |
| -------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Domain Port**            | 1     | `TokenEncryptionPort` — add `decrypt(ciphertext: Buffer, iv: Buffer): string`                                                                                                                |
| **Infrastructure Adapter** | 1     | `TokenEncryptionAdapter` — implement `decrypt`                                                                                                                                               |
| **Application Service**    | 1     | `HandleSpreadsheetFileSelection` — `execute(input)` with all flows                                                                                                                           |
| **Application Service**    | 1     | `HandleOAuthCallback` — pass `provider` in payload on transition to `ONBOARDING_FILE`                                                                                                        |
| **Text Copies**            | 1     | `onboardingCopies` — add `fileListPrompt`, `noFilesFoundPrompt`, `fileSelectedConfirmation`, `invalidSelectionRePrompt`, `searchByNamePrompt`, `urlValidationFailed`, `urlValidationSuccess` |
| **Test Suite**             | 2     | `HandleSpreadsheetFileSelection.spec.ts` — mocks for `CloudStoragePort`, `IOAuthTokenRepository`, `TransitionConversationState`, `MessagingOutputPort`, `TokenEncryptionPort`                |
| **Test Suite**             | 2     | `HandleOAuthCallback.spec.ts` — update transition payload assertion                                                                                                                          |

## Phases

### Phase 1: Extend contracts, copies, and implement the use case

**Description:** Extend `TokenEncryptionPort`/`Adapter` with `decrypt`. Add file-selection copies to `onboarding.copies.ts`. Fix `HandleOAuthCallback` to preserve the `provider` in the `ONBOARDING_FILE` transition payload. Create `HandleSpreadsheetFileSelection.ts` with all flows implemented (initial listing, selection by number, "none of these", search by name, direct URL, no files found).

- [x] Add `decrypt(ciphertext: Buffer, iv: Buffer): string` to `src/domain/ports/tokenEncryption.ts`.
- [x] Implement `decrypt` in `src/infrastructure/security/TokenEncryptionAdapter.ts` (wrapper over `aes256gcm.decrypt`).
- [x] Create `src/infrastructure/security/TokenEncryptionAdapter.spec.ts` with unit tests for round-trip encrypt/decrypt and error cases (wrong key length, invalid ciphertext).
- [x] Update `src/application/copies/onboarding.copies.ts` with file-selection copy functions:
  - `fileListPrompt(files: CloudFile[]): string` — numbered list + "None of these / search by name".
  - `noFilesFoundPrompt(): string`.
  - `fileSelectedConfirmation(fileName: string): string`.
  - `invalidSelectionRePrompt(fileCount: number): string`.
  - `searchByNamePrompt(): string`.
  - `urlValidationFailed(): string`.
  - `urlValidationSuccess(fileName: string): string`.
- [x] Fix `src/application/use-cases/spreadsheet/HandleOAuthCallback.ts` to pass `{ provider: metadata.provider }` in the payload when transitioning to `ONBOARDING_FILE`.
- [x] Create `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts` with the following structure:
  - Input: `{ userId: string; rawMessage: string; externalId: string; channel: 'telegram' | 'whatsapp'; statePayload: Record<string, unknown> | null }`
  - Output: `{ nextState: FsmState; message: string; payload?: Record<string, unknown> }`
  - Deps: `CloudStoragePort`, `IOAuthTokenRepository`, `TransitionConversationState`, `MessagingOutputPort`, `TokenEncryptionPort`
  - Flows:
    1. **Initial listing** (no `fileList` in payload): retrieve token, decrypt access token, call `listRecentSpreadsheets`, format list via `fileListPrompt`, self-transition to `ONBOARDING_FILE` with `fileList` in payload.
    2. **Selection by number**: validate choice against `fileList`, call `validateFileAccess`, send confirmation via `fileSelectedConfirmation`, transition to `ONBOARDING_SHEET` with `{ selectedFileId, selectedFileName }`.
    3. **"None of these"**: send `searchByNamePrompt`, self-transition to `ONBOARDING_FILE` with `step: 'searching'`.
    4. **Search by name** (`step === 'searching'`): call `searchSpreadsheets`, present refined list, update payload.
    5. **Direct URL**: extract `fileId` from Google Drive URL, call `validateFileAccess`, select or inform via `urlValidationSuccess` / `urlValidationFailed`.
    6. **No files found**: return `noFilesFoundPrompt`.
  - Error handling: missing/expired token, discovery errors, invalid provider.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Unit tests and validation

**Description:** Create comprehensive unit tests for `HandleSpreadsheetFileSelection` covering all flows and edge cases. Update `HandleOAuthCallback.spec.ts` to assert the new provider payload.

- [x] Create `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.spec.ts` with Vitest unit tests covering:
  - **Initial listing**: calls `listRecentSpreadsheets`, returns `ONBOARDING_FILE`, stores `fileList` in payload, sends formatted list message.
  - **Empty listing**: returns `noFilesFoundPrompt`, stays in `ONBOARDING_FILE`.
  - **Selection by number - success**: validates access, sends confirmation, transitions to `ONBOARDING_SHEET` with `selectedFileId` and `selectedFileName`.
  - **Selection by number - access denied**: sends failure message, stays in `ONBOARDING_FILE`.
  - **Invalid number**: sends `invalidSelectionRePrompt`, stays in `ONBOARDING_FILE`.
  - **"None of these"**: sends `searchByNamePrompt`, sets `step: 'searching'`, stays in `ONBOARDING_FILE`.
  - **Search by name**: calls `searchSpreadsheets`, presents results, stays in `ONBOARDING_FILE`.
  - **Search by name - no results**: sends `noFilesFoundPrompt`, stays in `ONBOARDING_FILE`.
  - **Direct URL - success**: extracts `fileId`, validates access, sends confirmation, transitions to `ONBOARDING_SHEET`.
  - **Direct URL - failure**: sends `urlValidationFailed`, stays in `ONBOARDING_FILE`.
  - **Missing OAuth token**: returns clear error message, stays in `ONBOARDING_FILE`.
  - **Expired OAuth token**: returns clear error message, stays in `ONBOARDING_FILE`.
  - **Invalid provider (microsoft)**: returns "coming soon" message, stays in `ONBOARDING_FILE`.
  - **Discovery error**: returns clear error message, stays in `ONBOARDING_FILE`.
- [x] Update `src/application/use-cases/spreadsheet/HandleOAuthCallback.spec.ts` to assert that `transitionState.execute` is called with a payload containing `provider: 'google'` when transitioning to `ONBOARDING_FILE`.
- [x] Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` to verify everything passes.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. The plan is fully implemented. Proceed to close the loop on the task file by checking off acceptance criteria in `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.02-select-the-spreadsheet-file/tasks/T-4.02-03.md`.
