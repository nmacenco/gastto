# Fix OAuth Refresh and Category Onboarding

## Goal

Keep spreadsheet access working across normal OAuth access-token expiration without repeating onboarding, and make category onboarding complete reliably during reconfiguration. Ensure category detection starts below the actual detected header row so spreadsheet headers are never stored or shown as categories.

## Context

- OAuth contract: [`oauth.ts`](../../../src/domain/ports/oauth.ts) exposes authorization-code exchange but not token refresh, even though the Google adapter already has a provider-specific `refreshToken` method.
- Google OAuth implementation: [`GoogleDriveOAuthAdapter.ts`](../../../src/infrastructure/adapters/oauth/GoogleDriveOAuthAdapter.ts) obtains the provider-defined `expires_in` value and already contains unexposed refresh-token HTTP logic.
- Encrypted token persistence: [`repositories.ts`](../../../src/domain/ports/repositories.ts) and [`DrizzleOAuthTokenRepository.ts`](../../../src/infrastructure/db/repositories/DrizzleOAuthTokenRepository.ts) already support reading tokens, persisting refreshed access tokens, recording `lastRefreshedAt`, and marking credentials revoked.
- Spreadsheet token consumers: expense save, undo, file selection, sheet selection, access validation, mapping inference/correction, category detection, and OAuth reminders currently read and validate tokens independently. Several reject a normally expired access token without attempting refresh.
- Save authorization recovery: [`RegisterExpense.ts`](../../../src/application/use-cases/expense/RegisterExpense.ts) rejects expired access tokens, while [`ResolveExpenseSummaryActionUseCase.ts`](../../../src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.ts) sends terminal authorization failures to `ONBOARDING_START`. The previously completed [`authorization reconnection plan`](../../2026_08_23-fix_auth_reconnection_loop/2026_08_23-fix_auth_reconnection_loop-plan.md) makes that terminal recovery path functional, but normal expiration should be resolved before reaching it.
- Spreadsheet error contract: [`SpreadsheetError.ts`](../../../src/domain/errors/SpreadsheetError.ts) supports typed `AUTH_ERROR`, `NETWORK_ERROR`, and `STRUCTURE_ERROR` outcomes. The Google Sheets adapter must classify HTTP responses consistently for refresh-and-retry decisions.
- Category completion: [`ConfirmCategories.ts`](../../../src/application/use-cases/spreadsheet/ConfirmCategories.ts) returns `IDLE` when `categoriesConfirmedAt` already exists but skips the actual FSM transition, leaving the persisted state in `ONBOARDING_CATEGORIES`.
- Category routing: [`message.worker.ts`](../../../src/interfaces/workers/message.worker.ts) correctly routes every later non-confirmation message to category modification while the persisted state remains `ONBOARDING_CATEGORIES`, which explains why expense text repeatedly produces the updated-category prompt.
- Header detection: [`InferColumnMapping.ts`](../../../src/application/use-cases/spreadsheet/InferColumnMapping.ts) stores the detected 1-based `headerRowIndex`, but [`ConfirmColumnMapping.ts`](../../../src/application/use-cases/spreadsheet/ConfirmColumnMapping.ts) drops it when entering category confirmation.
- Category reads: [`SpreadsheetCategoryReader.ts`](../../../src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.ts), [`GoogleSheetsAdapter.ts`](../../../src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts), and [`ExcelOnlineAdapter.ts`](../../../src/infrastructure/adapters/sheets/ExcelOnlineAdapter.ts) assume data always begins on row 2. A sheet whose detected header is on row 2 therefore includes the header value, such as `categoría`, in the vocabulary.
- Canonical architecture and behavior: [`ADR-007`](../../../docs/adr/ADR-007-oauth-aes256.md), [`error-taxonomy.md`](../../../docs/architecture/error-taxonomy.md), [`fsm-states.md`](../../../docs/architecture/fsm-states.md), [`cloud-storage-connection.md`](../../../docs/features/cloud-storage-connection.md), [`conversation-state-management.md`](../../../docs/features/conversation-state-management.md), [`confirm-or-correct-column-mapping.md`](../../../docs/features/confirm-or-correct-column-mapping.md), and [`category-confirmation.md`](../../../docs/features/category-confirmation.md).
- Testing rules: [`testing guidelines`](../../../docs/testing/guidelines.md) require boundary mocks, meaningful negative assertions, and complete FSM transition coverage.

No HTTP route, OpenAPI schema, database schema, migration, or domain event change is expected. OAuth tokens must remain encrypted at rest and must never appear in logs, errors, fixtures intended for snapshots, or user-facing messages.

## Phase 1: Refresh OAuth access transparently across spreadsheet operations

### Description

Deliver a complete normal-expiration recovery slice. A user with a valid encrypted refresh token can save, undo, and continue spreadsheet configuration without seeing onboarding again. Re-authentication remains the terminal fallback only when refresh credentials are missing, revoked, undecryptable, or rejected by the provider.

### To-do actions

- [x] Extend `OAuthServicePort` with `refreshAccessToken(provider, refreshToken)`, returning the new access token, expiration timestamp, and scopes without exposing provider response details to Application code.
- [x] Align `GoogleDriveOAuthAdapter` with the new port method and map a rejected or revoked refresh credential to a distinct terminal OAuth error, while preserving transient network failures as retryable/non-terminal errors.
- [x] Add an Application service `OAuthAccessTokenService` with `getValidAccessToken(input)` and `forceRefreshAccessToken(input)`. It must decrypt credentials, refresh tokens that are expired or within a five-minute safety window, encrypt the new access token with a fresh IV, persist it through `markRefreshed`, and return plaintext only to the immediate caller.
- [x] Make terminal refresh rejection call `markRevoked`; do not mark credentials revoked for network failures, provider 5xx responses, or other transient failures.
- [x] Update Google Sheets error classification so HTTP 401/403 becomes `SpreadsheetError` with `AUTH_ERROR`, network/provider 5xx failures become retryable `NETWORK_ERROR`, and structural failures retain `STRUCTURE_ERROR` where applicable.
- [x] Replace duplicated token expiration/decryption logic in expense save, undo, file selection, sheet selection, access validation, mapping inference, mapping correction, category detection, and any other spreadsheet token consumer with `OAuthAccessTokenService`.
- [x] For an external spreadsheet operation that returns `AUTH_ERROR` while using a token considered valid, force one refresh and replay that external operation exactly once. Never retry a write more than once, and preserve the existing save/undo idempotency safeguards so a successful write is not duplicated.
- [x] Preserve the current `AUTH_ERROR -> ONBOARDING_START` behavior and authorization-failure copy only after transparent refresh cannot restore access. Normal access-token expiration must not alter user status, spreadsheet configuration, mappings, categories, or FSM state.
- [x] Wire the service once in [`buildDependencies.ts`](../../../src/bootstrap/buildDependencies.ts) and inject it through Application ports rather than constructing OAuth infrastructure from use cases or workers.
- [x] Add unit tests for fresh-token reuse, safety-window refresh, already-expired refresh, new-IV encryption and persistence, missing/revoked token, decryption failure, rejected refresh with revocation, transient refresh failure without revocation, and forced single refresh after a provider `AUTH_ERROR`.
- [x] Add regression coverage proving that an expense can be saved after access-token expiration without entering onboarding, rerunning NLP, duplicating the spreadsheet append, or losing the existing spreadsheet/category configuration. Cover undo and at least one onboarding spreadsheet read through focused tests.
- [x] Update [`ADR-007`](../../../docs/adr/ADR-007-oauth-aes256.md) only if implementation details need clarification, and update [`docs/adr/README.md`](../../../docs/adr/README.md) in the same change if that ADR is modified.
- [x] Update [`error-taxonomy.md`](../../../docs/architecture/error-taxonomy.md), [`cloud-storage-connection.md`](../../../docs/features/cloud-storage-connection.md), and the affected expense behavior document to distinguish recoverable access-token expiration from terminal refresh-token authorization failure. Update [`docs/features/README.md`](../../../docs/features/README.md) for every changed feature document.
- [x] Run the focused OAuth adapter, token repository, expense save, undo, and spreadsheet-use-case Vitest suites, then run the complete `pnpm test` suite. Fix failures without weakening security or negative assertions.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Public contracts

- `OAuthServicePort.refreshAccessToken(provider: SpreadsheetProvider, refreshToken: string): Promise<{ accessToken: string; expiresAt: Date; scope: string[] }>`: provider-neutral refresh contract implemented by OAuth adapters.
- `OAuthAccessTokenService.getValidAccessToken(input: { userId: string; provider: SpreadsheetProvider; requiredScopes?: string[] }): Promise<{ accessToken: string; expiresAt: Date; refreshed: boolean }>`: returns a usable access token and refreshes proactively within a five-minute safety window.
- `OAuthAccessTokenService.forceRefreshAccessToken(input: { userId: string; provider: SpreadsheetProvider; requiredScopes?: string[] }): Promise<{ accessToken: string; expiresAt: Date; refreshed: true }>`: supports one controlled refresh after a typed provider `AUTH_ERROR`.
- `IOAuthTokenRepository` keeps its existing schema-level contract, including `markRefreshed(...)` and `markRevoked(...)`; no token table or migration changes are required.
- User-facing authorization behavior: normal access-token expiration is silent. The existing reconnection copy and `ONBOARDING_START` transition are used only for terminal authorization loss.
- Test contract: all refresh branches prove that plaintext access and refresh tokens are absent from logs and persisted database values.

## Phase 2: Make repeated category confirmation finish the FSM

### Description

Fix the category confirmation vertical slice for users whose spreadsheet configuration already has `categoriesConfirmedAt`, especially after reconnection or re-onboarding. Confirming categories must persist an active user and `IDLE` conversation before reporting completion, so the next expense is routed to expense registration.

### To-do actions

- [x] Refactor `ConfirmCategories.execute` so both first confirmation and repeated confirmation converge on the same finalization path: ensure user status is `active`, transition the persisted FSM to `IDLE` with cleared payload/expiration, and send `onboardingComplete()`.
- [x] Preserve idempotency by skipping only the redundant `categoriesConfirmedAt` write when it already exists. Do not skip user activation or the FSM transition.
- [x] Order finalization so the success message is never sent while the persisted FSM is still `ONBOARDING_CATEGORIES`.
- [x] Keep the missing-spreadsheet recovery path unchanged: send the reconnection copy and transition to `ONBOARDING_START` with `{ promptShown: true }`.
- [x] Update `ConfirmCategories.spec.ts` to assert the real `IDLE` transition and user activation for both new and already-confirmed configurations, including cleared payload/expiration semantics.
- [x] Add a worker regression covering `ONBOARDING_CATEGORIES + categoriesConfirmedAt already set + "sí"`, followed by `cafe 12 euros`, and prove the second message invokes expense interpretation rather than `ModifyCategoryVocabulary` or `DetectCategories`.
- [x] Add negative assertions that category confirmation does not re-read the spreadsheet, recreate categories, restart OAuth, or replay column mapping.
- [x] Update [`category-confirmation.md`](../../../docs/features/category-confirmation.md) and [`conversation-state-management.md`](../../../docs/features/conversation-state-management.md) to define repeated confirmation as a persisted idempotent finalization, then update [`docs/features/README.md`](../../../docs/features/README.md).
- [x] Run the focused category-confirmation and message-worker Vitest suites, then run the complete `pnpm test` suite. Fix failures without weakening assertions.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Public contracts

- `ConfirmCategories.execute(input: ConfirmCategoriesInput): Promise<ConfirmCategoriesOutput>` keeps its signature, but a successful return with `nextState: 'IDLE'` now guarantees that the persisted FSM is actually `IDLE` and the user is active.
- Idempotency contract: an existing `categoriesConfirmedAt` suppresses only the duplicate timestamp update; all required final-state invariants are re-established.
- User-facing copy: `onboardingComplete()` remains unchanged and is emitted only after successful finalization.
- Test contract: the observed re-onboarding sequence terminates category mode, and the next valid expense message enters the normal expense flow.

## Phase 3: Start category extraction below the detected header row

### Description

Carry the detected spreadsheet header position through mapping confirmation and use it to calculate the category data range. This prevents `categoría` or any other header label from becoming a user category when the sheet includes title or summary rows before its headers.

### To-do actions

- [ ] Preserve the validated 1-based `headerRowIndex` from the mapping FSM payload when `ConfirmColumnMapping` transitions to `ONBOARDING_CATEGORIES`.
- [ ] Extend the category-reader and spreadsheet-port contracts with a 1-based `dataStartRow`, calculated as `headerRowIndex + 1`; retain row 2 as the backward-compatible default when no header index is available.
- [ ] Update Google Sheets range generation and Excel Online range generation to begin at `dataStartRow` instead of hard-coded row 2, validating that the row number is a positive integer.
- [ ] Pass the preserved header position from `DetectCategories` through `SpreadsheetCategoryReader` to the selected spreadsheet adapter without persisting it in a new database column.
- [ ] Ensure default-category fallback still occurs only when there are no non-empty data values below the header. A header label by itself must no longer prevent fallback.
- [ ] Update mapping confirmation tests to prove `headerRowIndex` survives the transition and category detection tests to prove a header on row 2 reads from row 3.
- [ ] Update Google Sheets, Excel Online, and `SpreadsheetCategoryReader` tests for the default row-2 range, dynamic row-3-or-later ranges, invalid row input, normalization, deduplication, and header exclusion.
- [ ] Add an end-to-end worker-level regression for a sheet with a title on row 1, headers on row 2, and categories below it. Assert that the prompt contains the data categories and does not contain the header as a bullet item.
- [ ] Update [`confirm-or-correct-column-mapping.md`](../../../docs/features/confirm-or-correct-column-mapping.md) and [`category-confirmation.md`](../../../docs/features/category-confirmation.md) with the dynamic data-start-row contract, then update [`docs/features/README.md`](../../../docs/features/README.md).
- [ ] Run the focused mapping, category, Google Sheets, Excel Online, and message-worker Vitest suites, then run the complete `pnpm test` suite. Fix failures without weakening assertions.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Public contracts

- `SpreadsheetPort.getUniqueValues(fileId: string, columnIndex: number, sheetName: string, dataStartRow?: number): Promise<string[]>`: reads category values from the supplied 1-based starting row, defaulting to row 2.
- `ICategoryReaderPort.readCategories(fileId: string, columnIndex: number, sheetName: string, dataStartRow?: number): Promise<string[]>`: propagates the dynamic range while preserving normalization and deduplication behavior.
- Mapping-to-category FSM payload: `headerRowIndex` remains a 1-based integer through `ONBOARDING_MAPPING -> ONBOARDING_CATEGORIES` and is used to derive `dataStartRow`.
- User-facing category list: spreadsheet header labels are excluded; only normalized, unique, non-empty cells below the detected header are shown and persisted.
- No database contract changes are required because the header position is needed only during the active onboarding transition.

## Next step

Execute Phase 3 to start category extraction below the detected header row.
