# Plan: OAuth callback routes, reminder worker, and message-worker integration

## Goal

Wire the existing Application-layer OAuth use cases (`HandleOAuthCallback`, `CancelCloudConnection`, `SendOAuthReminder`) into the Interface layer by: (1) exposing Fastify callback routes for Google and Microsoft, (2) creating a BullMQ reminder worker, and (3) replacing onboarding placeholders in the message worker with real handlers for `ONBOARDING_START` and `ONBOARDING_DRIVE`.

## Context

- `AGENTS.md`: Architecture (Clean Architecture, Fastify + BullMQ in single process), DB conventions, Swagger/OpenAPI rules, testing rules.
- `docs/plans/plan-conventions.md`: Plan structure and conventions used here.
- `src/main.ts`: Application bootstrap. Already wires `InitiateCloudConnection`, `messageWorker`, `incomingMessageWorker`, `sessionTimeoutWorker`. Needs new routes, worker, and use-case instances.
- `src/interfaces/http/routes/telegram.webhook.ts`: Reference pattern for registering Fastify routes with Zod schemas, `app.withTypeProvider<ZodTypeProvider>()`, and independent route tests with `validatorCompiler`/`serializerCompiler`.
- `src/interfaces/workers/message.worker.ts`: Stage-2 BullMQ worker. Currently delegates `ONBOARDING_START` to `InitiateCloudConnection` (already wired) and sends placeholders for `ONBOARDING_DRIVE` and later states.
- `src/interfaces/workers/incomingMessage.worker.ts` / `sessionTimeout.worker.ts`: Reference patterns for BullMQ worker creation and registration.
- Application use cases (already implemented, not modified):
  - `src/application/use-cases/spreadsheet/HandleOAuthCallback.ts`
  - `src/application/use-cases/spreadsheet/CancelCloudConnection.ts`
  - `src/application/use-cases/spreadsheet/SendOAuthReminder.ts`
  - `src/application/use-cases/spreadsheet/InitiateCloudConnection.ts`
- `src/domain/ports/tokenEncryption.ts`: `TokenEncryptionPort` interface. No implementation exists yet; `src/infrastructure/security/aes256gcm.ts` provides raw `encrypt`/`decrypt` functions.
- `src/infrastructure/db/repositories/DrizzleOAuthTokenRepository.ts`: Repository for persisting tokens.
- `src/application/copies/onboarding.copies.ts`: Copies shown to users during onboarding.

## Phases

### Phase 1: Google OAuth callback route

- [x] Create `src/interfaces/http/routes/oauth.callback.ts`.
- [x] Register `GET /auth/google/callback` with `app.withTypeProvider<ZodTypeProvider>()`.
- [x] Zod query schema: `z.object({ code: z.string(), state: z.string() })`.
- [x] Route handler deserializes params, validates with Zod, and delegates to `HandleOAuthCallback.execute`.
- [x] On success: return HTML response "You can close this window" (HTTP 200).
- [x] On failure: return HTML response with the error message (HTTP 200) to avoid browser errors.
- [x] Swagger schema must include `tags`, `description`, and `response` schemas.
- [x] Create `src/interfaces/http/routes/oauth.callback.spec.ts`.
- [x] Tests instantiate Fastify independently and register `validatorCompiler` and `serializerCompiler` from `fastify-type-provider-zod`.
- [x] Test cases:
  - Valid `code` + `state` delegates to use case and returns success HTML.
  - Missing query params returns 400 (Zod validation).
  - Use-case failure returns failure HTML.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Microsoft OAuth callback route and Token Encryption Adapter

- [x] Extend `oauth.callback.ts` with `GET /auth/microsoft/callback` using the same Zod query schema and handler pattern.
- [x] Extend `oauth.callback.spec.ts` with tests for the Microsoft route (same cases as Google).
- [x] Create `src/infrastructure/security/TokenEncryptionAdapter.ts` implementing `TokenEncryptionPort`.
- [x] The adapter wraps `encrypt(plaintext, key)` from `aes256gcm.ts`, injecting `env.ENCRYPTION_KEY` (parsed from hex string to Buffer).
- [x] Create `src/infrastructure/security/TokenEncryptionAdapter.spec.ts` with tests:
  - Encrypt returns non-empty ciphertext and IV.
  - Decrypt round-trip recovers original plaintext.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Wire OAuth routes and HandleOAuthCallback into main.ts

- [x] In `src/main.ts`, instantiate `DrizzleOAuthTokenRepository` and `TokenEncryptionAdapter`.
- [x] Instantiate `HandleOAuthCallback` with all required deps: `redis`, `googleOAuthAdapter` (or a multi-provider adapter), `tokenRepository`, `reminderQueue`, `transitionState`, `messagingPort` (telegramAdapter), `tokenEncryption`.
- [x] Register both callback routes in `main.ts` by calling the route registration function from `oauth.callback.ts`.
- [x] Ensure routes are only registered when the required env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`) are present.
- [x] Update Swagger `tags` array in `main.ts` to include `Auth` tag if not present.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 4: OAuth Reminder Worker

- [x] Create `src/interfaces/workers/oauthReminder.worker.ts`.
- [x] Worker consumes `oauth-reminder` queue jobs. Job data shape: `{ userId: string; externalId: string; channel: 'telegram' | 'whatsapp' }`.
- [x] Handler delegates to `SendOAuthReminder.execute` with the job data plus `provider` and `redirectUri`.
- [x] Create `src/interfaces/workers/oauthReminder.worker.spec.ts`.
- [x] Mock `bullmq.Worker` and `Queue`. Test that the processor delegates correctly to `SendOAuthReminder`.
- [x] In `src/main.ts`, instantiate `SendOAuthReminder` with deps: `redis`, `oauthService`, `tokenRepository`, `reminderQueue`, `transitionState`, `messagingPort`.
- [x] Register the worker in `main.ts` (similar to `createSessionTimeoutWorker`).
- [x] The `reminderQueue` is already created in `main.ts`; ensure it is passed to both `InitiateCloudConnection` and `SendOAuthReminder`.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 5: Message Worker - ONBOARDING_START handler

- [x] In `src/interfaces/workers/message.worker.ts`, replace the current `ONBOARDING_START` block.
- [x] Current logic already delegates to `InitiateCloudConnection`. Ensure `MessageWorkerDeps` still satisfies this.
- [x] If `initiateCloudConnection` is null/wired, the use case already sends `providerPrompt()` on invalid input and handles provider choice. Verify the existing delegation is sufficient per T-4.01-09 AC.
- [x] Add a defensive check: if `initiateCloudConnection` is null/undefined, send `onboardingCopies.onboardingPlaceholder()` (already exists).
- [x] Update `src/interfaces/workers/message.worker.spec.ts` tests for `ONBOARDING_START` to assert the exact behavior (valid choice delegates, invalid choice re-prompts). Note: re-prompt logic lives inside `InitiateCloudConnection`, so worker tests only need to verify delegation.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 6: Message Worker - ONBOARDING_DRIVE handler and final wiring

- [x] In `src/interfaces/workers/message.worker.ts`, replace the `ONBOARDING_DRIVE` placeholder (currently grouped with `ONBOARDING_FILE`, `ONBOARDING_SHEET`, etc. sending `onboardingCopies.onboardingPlaceholder()`).
- [x] Extract `ONBOARDING_DRIVE` into its own case.
- [x] Handler checks `rawMessage.toLowerCase().trim()` for "cancelar".
  - If matches: read `state` from `conversationState.statePayload?.state`, then call `CancelCloudConnection.execute({ userId, state, externalId, channel })`. The use case transitions back to `IDLE` and sends the cancellation message.
  - If no match: send "Please complete the authorization in your browser or type cancel to abort" using `MessagingOutputPort.sendMessage`. Do not transition state.
- [x] Extend `MessageWorkerDeps` to include `cancelCloudConnection: CancelCloudConnection | null`.
- [x] In `src/main.ts`, instantiate `CancelCloudConnection` with deps: `redis`, `reminderQueue`, `transitionState`, `messagingPort` (telegramAdapter).
- [x] Inject `cancelCloudConnection` into `createMessageWorker` deps in `main.ts`.
- [x] Add/update tests in `message.worker.spec.ts` for `ONBOARDING_DRIVE`:
  - "cancelar" triggers `CancelCloudConnection.execute` with correct args.
  - Other message sends the wait prompt without calling `cancelCloudConnection`.
  - Null `cancelCloudConnection` falls back to placeholder.
- [x] Update `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.01-connect-cloud-storage-account/tasks/T-4.01-08.md` and `T-4.01-09.md` acceptance criteria checkboxes as they are satisfied.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Run `pnpm test` to ensure all tests pass.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases complete. Plan is fully implemented.
