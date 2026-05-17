# Telegram Webhook Route & Validation Middleware

## 🎯 Goal

Refactor the existing inline Telegram webhook handler into a well-structured Fastify route with a dedicated controller (T-0.01-02), then extract the secret-token validation into a reusable `preHandler` middleware (T-0.01-03). Both phases include unit tests to ensure the route responds correctly and unauthorized requests are rejected with HTTP 403.

## 👀 Context

- `docs/plans/plan-conventions.md`: Plan file structure and conventions.
- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.01-register-telegram-bot-and-configure-webhook/tasks/T-0.01-02.md`: Task for creating the POST route and controller.
- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.01-register-telegram-bot-and-configure-webhook/tasks/T-0.01-03.md`: Task for implementing source validation middleware.
- `src/interfaces/http/routes/telegram.webhook.ts`: Current inline handler combining validation + parsing + dispatch. This file will be refactored.
- `src/main.ts`: Fastify bootstrap where the route is registered.
- `src/config/env.schema.ts`: Contains `TELEGRAM_WEBHOOK_SECRET` env var definition.
- `src/domain/ports/services.ts`: Defines `MessagingPort` used by the route.
- `src/application/use-cases/user/ResolveUserIdentity.ts`: Use case invoked by the controller.
- `src/interfaces/workers/message.worker.ts`: Consumer of the BullMQ queue populated by the route.

---

## 🪜 Phase 1: Refactor Route & Controller (T-0.01-02)

**Description:**
Reorganize `telegram.webhook.ts` into a clean separation between route registration and controller logic. The secret-token validation remains inline for now (to keep the system secure), but the controller function becomes independently testable. Add a comprehensive test suite `telegram.webhook.spec.ts` that verifies payload parsing, dispatch to the use case/queue, and HTTP 200 responses. No public contracts change in this phase; only internal structure improves.

**Public Contracts (created / modified):**

- Application services: None changed.
- Domain events: None changed.
- Test suites:
  - `src/interfaces/http/routes/telegram.webhook.spec.ts` (new): tests for valid payload (HTTP 200), unparseable payload (HTTP 200 to avoid Telegram retries), non-text message handling, and correct enqueue/job data shape.
- Database schemas: None changed.
- UI / email copies: None changed.

**To-do actions:**

- [x] Create `src/interfaces/http/routes/telegram.webhook.spec.ts` with a helper `buildApp()` that registers the route with mocked dependencies (`webhookSecret`, `messageQueue`, `resolveIdentity`, `telegramMessaging`).
- [x] Add test: valid Telegram text message → parses payload, calls `resolveIdentity.execute`, enqueues BullMQ job with correct `ProcessMessageJobData`, returns HTTP 200.
- [x] Add test: missing or malformed payload → returns HTTP 200 (to avoid infinite Telegram retries), does not enqueue.
- [x] Add test: valid payload but `message.text` is missing (e.g., photo/sticker) → sends fallback message via `telegramMessaging.sendMessage`, returns HTTP 200.
- [x] Refactor `telegram.webhook.ts` into a `registerTelegramWebhook(app, opts)` function and a separate controller/handler function (e.g., `handleTelegramWebhook(req, reply, deps)`) to improve testability without changing behavior.
- [x] Run `pnpm lint` and `pnpm typecheck` from project root. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

---

## 🪜 Phase 2: Extract Validation Middleware (T-0.01-03)

**Description:**
Extract the `X-Telegram-Bot-Api-Secret-Token` check from the controller into a reusable Fastify `preHandler` hook factory. Register the middleware at the route level in `registerTelegramWebhook`. Add `telegram.validation.spec.ts` to assert that missing/invalid tokens return HTTP 403 and that valid tokens pass through. Remove the inline validation from the controller handler.

**Public Contracts (created / modified):**

- Application services: None changed.
- Domain events: None changed.
- Test suites:
  - `src/interfaces/http/routes/telegram.validation.spec.ts` (new): tests for missing token (403), invalid token (403), valid token (pass-through / 200), and ensuring no downstream processing occurs on rejected requests.
- Database schemas: None changed.
- UI / email copies: None changed.

**To-do actions:**

- [x] Create a new file `src/interfaces/http/middleware/telegramAuth.ts` exporting `validateTelegramOrigin(secret: string): preHandlerHookHandler` that reads `req.headers['x-telegram-bot-api-secret-token']` and replies with 403 if it does not match the configured secret.
- [x] Create `src/interfaces/http/middleware/telegramAuth.spec.ts` (or keep tests alongside route tests if preferred) verifying:
  - Missing header → HTTP 403.
  - Invalid header → HTTP 403, no further processing.
  - Valid header → passes control to next handler.
- [x] Update `registerTelegramWebhook` in `telegram.webhook.ts` to register the new `preHandler` on the `/webhook/telegram` route instead of checking the token inside the handler.
- [x] Remove the inline secret-token validation block from the controller handler.
- [x] Update `main.ts` if needed to pass the secret to the middleware factory instead of (or in addition to) the route opts.
- [x] Run `pnpm lint` and `pnpm typecheck` from project root. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

---

## ⏭️ Next step

All phases are complete. No further implementation work is needed. Consider committing the changes and exporting this conversation for documentation.
