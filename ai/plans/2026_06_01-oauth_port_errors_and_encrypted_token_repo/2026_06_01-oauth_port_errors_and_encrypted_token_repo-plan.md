# Plan: OAuth Service Port, Domain Errors, and Encrypted Token Repository

## Goal

Define the `OAuthServicePort` interface and four OAuth-specific domain errors in the Domain layer. Then implement an AES-256-GCM encryption utility and a Drizzle-backed `OAuthTokenRepository` that encrypts tokens at rest and decrypts them on retrieval, satisfying ADR-007.

## Context

- The project follows Clean Architecture: Domain defines contracts, Infrastructure implements them.
- `IOAuthTokenRepository` already exists in [`src/domain/ports/repositories.ts`](../../src/domain/ports/repositories.ts) and the `OAuthToken` entity is in [`src/domain/entities/SpreadsheetConfig.ts`](../../src/domain/entities/SpreadsheetConfig.ts).
- The `oauth_tokens` Drizzle schema is in [`src/infrastructure/db/schema/index.ts`](../../src/infrastructure/db/schema/index.ts); a migration already exists, so no new migration is required.
- The AES-256-GCM encryption utility does **not** exist yet; it must be created for this task.
- Domain errors extend `Error` directly (see [`src/domain/errors/DomainValidationError.ts`](../../src/domain/errors/DomainValidationError.ts)).
- The `ENCRYPTION_KEY` environment variable is commented out in [`src/config/env.schema.ts`](../../src/config/env.schema.ts) and must be enabled.
- Relevant documentation:
  - [`docs/adr/ADR-007-oauth-aes256.md`](../../docs/adr/ADR-007-oauth-aes256.md): encryption requirements.
  - [`docs/testing/guidelines.md`](../../docs/testing/guidelines.md): test coverage and mocking rules.
  - [`docs/plans/plan-conventions.md`](../../docs/plans/plan-conventions.md): plan structure conventions.

## Phases

### Phase 1: Domain layer — OAuth service port and domain errors

**Description:**
Create the `OAuthServicePort` interface so the Application layer can initiate and complete OAuth flows without knowing provider specifics. Define four recoverable/unrecoverable OAuth domain errors that use cases and adapters will throw and catch.

**Public contracts created / modified:**

- Application services: `OAuthServicePort` (`buildAuthUrl`, `exchangeCode`)
- Test suites: none for this phase (type-level verification via `pnpm typecheck`)

**To-do actions:**

- [x] Create `src/domain/ports/oauth.ts` with:
  - `SpreadsheetProvider` import from `../entities/SpreadsheetConfig`
  - `OAuthServicePort` interface with:
    - `buildAuthUrl(provider: SpreadsheetProvider, userId: string, redirectUri: string): string`
    - `exchangeCode(provider: SpreadsheetProvider, code: string, state: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date; scope: string[] }>`
- [x] Create `src/domain/errors/OAuthDeniedError.ts` (extends `Error`)
- [x] Create `src/domain/errors/OAuthNetworkError.ts` (extends `Error`)
- [x] Create `src/domain/errors/InvalidProviderError.ts` (extends `Error`)
- [x] Create `src/domain/errors/OAuthStateMismatchError.ts` (extends `Error`)
- [x] Update `src/domain/ports/index.ts` to re-export from `./oauth`
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Infrastructure — AES-256-GCM utility and DrizzleOAuthTokenRepository

**Description:**
Build the AES-256-GCM encryption utility, enable the `ENCRYPTION_KEY` environment variable, and implement the `DrizzleOAuthTokenRepository` that encrypts tokens before persistence and decrypts them after retrieval. Provide unit tests for both the cipher and the repository.

**Public contracts created / modified:**

- Application services: none
- Domain events: none
- Test suites:
  - `src/infrastructure/security/aes256gcm.spec.ts` — encrypt/decrypt round-trip tests
  - `src/infrastructure/db/repositories/DrizzleOAuthTokenRepository.spec.ts` — mocked Drizzle DB tests for `findByUserAndProvider`, `upsert`, `markRefreshed`, `markRevoked`

**To-do actions:**

- [x] Create `src/infrastructure/security/aes256gcm.ts` with:
  - `encrypt(plaintext: string, key: Buffer): { ciphertext: Buffer; iv: Buffer }` (auth tag appended to ciphertext)
  - `decrypt(ciphertext: Buffer, iv: Buffer, key: Buffer): string`
  - Uses Node.js `crypto` module (`createCipheriv` / `createDecipheriv`) with `aes-256-gcm`
- [x] Create `src/infrastructure/security/aes256gcm.spec.ts` with round-trip tests and invalid-key/decryption-failure tests
- [x] Uncomment `ENCRYPTION_KEY` in `src/config/env.schema.ts` and mark it as required
- [x] Update `.env.example` to uncomment `ENCRYPTION_KEY`
- [x] Update `src/config/env.spec.ts` to include `ENCRYPTION_KEY` in all test cases
- [x] Create `src/infrastructure/db/repositories/DrizzleOAuthTokenRepository.ts` implementing `IOAuthTokenRepository`:
  - Constructor receives `PostgresJsDatabase<typeof schema>`
  - `findByUserAndProvider`: selects from `oauth_tokens`, returns mapped `OAuthToken`
  - `upsert`: inserts or updates on conflict `(userId, provider)`, returns mapped `OAuthToken`
  - `markRefreshed`: updates `accessTokenEnc`, `iv`, `accessTokenExpiresAt`, `lastRefreshedAt`
  - `markRevoked`: sets `revokedAt` to `new Date()`
  - Private mapper method `mapOAuthToken` converts Drizzle row to domain `OAuthToken`
- [x] Create `src/infrastructure/db/repositories/DrizzleOAuthTokenRepository.spec.ts` with mocked Drizzle DB tests covering all four methods, following the `DrizzleConversationStateRepository.spec.ts` pattern
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases completed. Proceed to **Task T-4.01-03** (Google Drive OAuth adapter) and **Task T-4.01-04** (OneDrive OAuth adapter), which depend on the domain port defined in Phase 1.
