# Plan: Store the OAuth refresh-token IV

## Goal

Fix the OAuth callback bug where the refresh token is encrypted with a fresh AES-256-GCM IV but only the access-token IV is persisted, so future refresh-token decryption would fail. Persist a separate `refreshIv` for each token row.

## Context

- Bug location: `src/application/use-cases/spreadsheet/HandleOAuthCallback.ts` calls `tokenEncryption.encrypt()` twice but stores only `accessEnc.iv`.
- Encryption helper: `src/infrastructure/security/aes256gcm.ts` generates a fresh `randomBytes(16)` IV per call, so the two IVs are always different.
- Entity: `OAuthToken` in `src/domain/entities/SpreadsheetConfig.ts`.
- Schema: `oauth_tokens` table in `src/infrastructure/db/schema/index.ts`.
- Repository: `DrizzleOAuthTokenRepository` in `src/infrastructure/db/repositories/DrizzleOAuthTokenRepository.ts`.
- Decrypt sites (`InferColumnMapping`, `HandleSheetSelection`, `CorrectColumnMapping`, `HandleSpreadsheetFileSelection`, `ValidateSpreadsheetAccess`) use `token.iv` for the access token and remain unchanged.
- Existing docs: `docs/features/cloud-storage-connection.md`, `docs/architecture/data-model.md`.
- Assumption: no existing `oauth_tokens` rows need migration backfill.

## Public contracts

### Modified

1. **Database schema** - `oauth_tokens` table adds `refresh_iv BYTEA NOT NULL`.
2. **Domain entity** - `OAuthToken` interface adds `refreshIv: Buffer`.
3. **Repository contract** - `IOAuthTokenRepository.upsert` input (via `OAuthToken`) requires `refreshIv`; `DrizzleOAuthTokenRepository` maps it.
4. **Application service** - `HandleOAuthCallback.execute` passes both `accessEnc.iv` and `refreshEnc.iv` to `upsert`.
5. **Test suites** - `DrizzleOAuthTokenRepository.spec.ts` and `HandleOAuthCallback.spec.ts` updated to assert both IVs are stored and distinct.
6. **Documentation** - `docs/architecture/data-model.md` and `docs/features/cloud-storage-connection.md` updated.

### Unchanged

- `TokenEncryptionPort` interface and AES-256-GCM adapter.
- `HandleOAuthCallbackInput` / `HandleOAuthCallbackOutput`.
- Fastify OAuth callback routes.
- `markRefreshed` signature (only the access token is refreshed).

## Phases

### Phase 1 - Persist the refresh-token IV

Functional fix across data layer, repository, and use case.

- [x] Add `refreshIv: Buffer` to the `OAuthToken` interface in `src/domain/entities/SpreadsheetConfig.ts`.
- [x] Add `refreshIv: bytea('refresh_iv').notNull()` to `oauth_tokens` in `src/infrastructure/db/schema/index.ts`.
- [x] Generate the Drizzle migration with `pnpm db:generate`.
- [x] Update `DrizzleOAuthTokenRepository` (`src/infrastructure/db/repositories/DrizzleOAuthTokenRepository.ts`) to:
  - include `refreshIv` in the insert/update values,
  - include it in the `onConflictDoUpdate` `set` clause,
  - map it in `mapOAuthToken`.
- [x] Update `HandleOAuthCallback` (`src/application/use-cases/spreadsheet/HandleOAuthCallback.ts`) to pass `refreshEnc.iv` as `refreshIv` in the `tokenRepository.upsert(...)` call.
- [x] Update `DrizzleOAuthTokenRepository.spec.ts`:
  - add `refreshIv` to `buildOAuthTokenRow`,
  - assert `refreshIv` is returned by `findByUserAndProvider`,
  - assert `upsert` receives and persists `refreshIv`.
- [x] Update `HandleOAuthCallback.spec.ts`:
  - make `mockEncrypt` return distinct `iv` values for the access and refresh encryptions,
  - assert `mockTokenUpsert` is called with the correct distinct `iv` and `refreshIv`.
- [x] Update integration test fixtures and specs (`tests/integration/helpers/fixtures.ts`, `tests/integration/oauth-token/DrizzleOAuthTokenRepository.integration.spec.ts`) so token rows include `refreshIv`.
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2 - Sync canonical docs and final verification

Close the documentation gap and run the full ship check.

- [x] Update `docs/architecture/data-model.md`:
  - add `refresh_iv` to the `oauth_tokens` table definition,
  - clarify that `iv` is the access-token IV.
- [x] Update `docs/features/cloud-storage-connection.md`:
  - update the callback step to mention both IVs are persisted,
  - update the QA checklist item for callback success to assert both IVs are stored.
- [x] Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. Suggest exporting this conversation and saving it as `ai/plans/2026_07_06-store_refresh_token_iv/2026_07_06-store_refresh_token_iv-conversation.md`, then committing the changes.
