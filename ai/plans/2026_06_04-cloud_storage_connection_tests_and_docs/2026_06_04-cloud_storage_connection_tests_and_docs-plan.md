# Cloud Storage Connection Tests and Documentation

## Goal

Close the remaining gaps for task T-4.01-10 by fixing existing unit-test bugs, adding `DrizzleOAuthTokenRepository` integration tests against a real database, and completing the canonical feature documentation for the cloud-storage connection flow.

## Context

- **Task source:** `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.01-connect-cloud-storage-account/tasks/T-4.01-10.md`
- **Feature documentation (existing, incomplete):** `docs/features/cloud-storage-connection.md`
- **Testing guidelines:** `docs/testing/guidelines.md`
- **Architecture:** `docs/adr/adr.md` and `AGENTS.md`

**Existing test coverage (already passing):**

- `src/application/use-cases/spreadsheet/InitiateCloudConnection.spec.ts`
- `src/application/use-cases/spreadsheet/HandleOAuthCallback.spec.ts`
- `src/application/use-cases/spreadsheet/CancelCloudConnection.spec.ts`
- `src/application/use-cases/spreadsheet/SendOAuthReminder.spec.ts`
- `src/infrastructure/adapters/oauth/GoogleDriveOAuthAdapter.spec.ts`
- `src/infrastructure/db/repositories/DrizzleOAuthTokenRepository.spec.ts` (unit tests with mocked DB)
- `src/interfaces/http/routes/oauth.callback.spec.ts`

**Integration test infrastructure:**

- `tests/integration/helpers/db-container.ts` (Testcontainers PostgreSQL)
- `tests/integration/helpers/migrate.ts` (Drizzle migrations)
- `tests/integration/helpers/fixtures.ts` (shared factories)

**OneDrive adapter:** Not implemented. The feature doc explicitly lists it as out-of-scope for the MVP. Integration tests for `OneDriveOAuthAdapter` are therefore blocked and will be documented as such rather than creating a stub adapter.

## Phases

### Phase 1: Fix unit-test gaps and bugs

- [x] Fix the `markRefreshed` vs `markRevoked` bug in `src/infrastructure/db/repositories/DrizzleOAuthTokenRepository.spec.ts`. The first test under `describe('markRefreshed')` calls `markRevoked`; it should call `markRefreshed`.
- [x] Add missing error-path tests to `src/application/use-cases/spreadsheet/SendOAuthReminder.spec.ts`:
  - `buildAuthUrl` throws (e.g. invalid provider) and no side effects occur.
  - BullMQ `queue.add` rejects and no side effects occur.
- [x] Add missing negative assertions where applicable (e.g. ensure no messaging call when a dependency fails).
- [x] Run `pnpm test` and verify all unit tests pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Add DrizzleOAuthTokenRepository integration tests

- [x] Create `tests/integration/oauth-token/DrizzleOAuthTokenRepository.integration.spec.ts`.
- [x] Re-use the existing Testcontainers PostgreSQL setup (`tests/integration/helpers/db-container.ts`, `tests/integration/helpers/migrate.ts`).
- [x] Write the following integration scenarios against the real database:
  - `upsert` inserts a new token; `findByUserAndProvider` returns the mapped entity.
  - `upsert` on conflict updates the existing token for the same `(userId, provider)`.
  - `findByUserAndProvider` returns `null` when no row exists.
  - `markRefreshed` updates `accessTokenEnc`, `iv`, `accessTokenExpiresAt`, and `lastRefreshedAt`.
  - `markRevoked` sets `revokedAt`.
  - **OAuth Token Encryption round-trip:** verify that raw DB query results only contain encrypted buffers (`accessTokenEnc`, `refreshTokenEnc`, `iv`) and that plaintext tokens never appear in query results.
- [x] Run `pnpm test` and verify the new integration tests pass (they will skip automatically if Docker is unavailable).
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Complete feature documentation

- [x] Add an **API Contracts** section to `docs/features/cloud-storage-connection.md` documenting:
  - Fastify route schemas for `GET /auth/google/callback` and `GET /auth/microsoft/callback` (Zod querystring: `code`, `state`).
  - Response contracts (200 HTML success/failure, 400 validation error).
  - DTOs used by the Application use cases (`InitiateCloudConnectionInput`, `HandleOAuthCallbackInput`, etc.).
- [x] Add a **QA Checklist** section covering:
  - Google Drive happy path (auth link generation, callback success, reminder firing, cancellation).
  - Google Drive error paths (denied, network failure, invalid state, persistence failure).
  - OneDrive documented as out-of-scope for MVP with a reference to future implementation.
- [x] Update `docs/features/README.md` index if the feature doc file name or location changes (not expected).
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases complete. The remaining step is to commit the changes and, if desired, export the conversation history alongside the plan file.
