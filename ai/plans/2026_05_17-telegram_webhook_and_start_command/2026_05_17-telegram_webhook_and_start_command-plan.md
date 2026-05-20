# Plan: Telegram Webhook Configuration and /start Command Use Case

## Goal

Implement the `HandleStartCommand` application use case with a proper `IChatMessenger` port, create the Telegram adapter, and prepare the production webhook configurator. Wire everything into the Fastify route so that the `/start` command triggers a welcome message while preserving the existing async pipeline for all other messages.

## Context

- `AGENTS.md` defines the Clean Architecture layers (`domain`, `application`, `infrastructure`, `interfaces`) and build/test commands.
- `docs/adr/adr.md` documents the monolith topology, BullMQ async pipeline (ADR-005), messaging port abstraction, and user identity resolution (ADR-008).
- `docs/plans/plan-conventions.md` governs plan structure and public contracts.
- Existing code:
  - `src/interfaces/http/routes/telegram.webhook.ts`: Fastify route that validates origin, parses payload, resolves identity, enqueues BullMQ job, and sends an ack.
  - `src/interfaces/http/middleware/telegramAuth.ts`: `X-Telegram-Bot-Api-Secret-Token` validation.
  - `src/application/use-cases/user/ResolveUserIdentity.ts`: identity resolution use case.
  - `src/domain/ports/services.ts`: defines `MessagingPort`, `LLMPort`, `SpreadsheetPort`.
  - `src/config/env.schema.ts`: environment schema with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` (both optional during skeleton).
- The task files to satisfy:
  - `T-0.01-04`: Configure production webhook via Telegram API.
  - `T-0.01-05`: Implement `/start` command use case and welcome message.

## Public Contracts

- **Application services**: `HandleStartCommand` use case with `execute(input: HandleStartCommandInput): Promise<HandleStartCommandOutput>`.
- **Application ports**: `IChatMessenger` (new file in `src/application/ports/`) with `sendWelcome(chatId: string, username?: string): Promise<void>`.
- **Infrastructure adapters**:
  - `TelegramMessengerAdapter` implementing both `IChatMessenger` and `MessagingPort`.
  - `TelegramWebhookConfigurator` with `setWebhook(url: string, secretToken: string): Promise<boolean>` and `getWebhookInfo(): Promise<WebhookInfo>`.
- **Interface routes**: `POST /webhook/telegram` updated to detect `/start` and short-circuit to the use case before the existing enqueue flow.
- **Test suites**:
  - `src/application/use-cases/conversation/HandleStartCommand.spec.ts`
  - `src/infrastructure/adapters/telegram/TelegramMessengerAdapter.spec.ts`
  - `src/infrastructure/adapters/telegram/TelegramWebhookConfigurator.spec.ts`
  - Updated `src/interfaces/http/routes/telegram.webhook.spec.ts`
- **Text copies**: Welcome message returned by the use case (configurable via output DTO, not hardcoded in the route).

## Phases

### Phase 1: Application Use Case, Port, and Unit Tests

**Description**: Implement the `HandleStartCommand` use case in the Application layer with clean input/output DTOs. Define the `IChatMessenger` application port so the use case remains agnostic of Telegram. Write unit tests that verify the use case independently of any transport layer.

**To-do actions**:

- [x] Create `src/application/ports/IChatMessenger.ts` with the `IChatMessenger` interface.
- [x] Create `src/application/use-cases/conversation/HandleStartCommand.ts` with:
  - `HandleStartCommandInput` DTO: `{ chatId: string; username?: string }`
  - `HandleStartCommandOutput` DTO: `{ replyText: string }`
  - `HandleStartCommand.execute()` that returns a welcome message.
- [x] Create `src/application/use-cases/conversation/HandleStartCommand.spec.ts` with tests:
  - Returns welcome message for valid input.
  - Output DTO is deterministic and testable without Fastify or Telegram.
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

---

### Phase 2: Telegram Adapter, Webhook Configurator, and Tests

**Description**: Build the Infrastructure-layer Telegram adapter that implements `IChatMessenger` and `MessagingPort`. Also create a `TelegramWebhookConfigurator` for calling Telegram's `setWebhook` and `getWebhookInfo` APIs. Add tests with mocked HTTP responses.

**To-do actions**:

- [x] Create `src/infrastructure/adapters/telegram/TelegramMessengerAdapter.ts`:
  - Implements `IChatMessenger` (`sendWelcome`) and `MessagingPort` (`sendMessage`).
  - Uses `fetch` to call `https://api.telegram.org/bot<token>/sendMessage`.
- [x] Create `src/infrastructure/adapters/telegram/TelegramWebhookConfigurator.ts`:
  - `setWebhook(url, secretToken)` calls `setWebhook` API; returns `true` on `ok`.
  - `getWebhookInfo()` calls `getWebhookInfo` API; returns parsed `WebhookInfo`.
- [x] Create `src/infrastructure/adapters/telegram/TelegramMessengerAdapter.spec.ts` (mock fetch).
- [x] Create `src/infrastructure/adapters/telegram/TelegramWebhookConfigurator.spec.ts` (mock fetch).
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

---

### Phase 3: Route Integration, Wiring, and Full Test Suite

**Description**: Update the Fastify webhook route to detect `/start` commands and delegate to `HandleStartCommand` before falling back to the existing BullMQ enqueue flow. Wire the new adapter into `main.ts`, inject dependencies, and update route tests. Ensure the `/start` path returns the welcome message synchronously while all other messages continue through the async pipeline.

**To-do actions**:

- [x] Refactor `src/interfaces/http/routes/telegram.webhook.ts`:
  - Parse `message.text`; if it equals `/start` (case-insensitive), delegate to `HandleStartCommand`.
  - The route handler maps raw Telegram `Update` to `HandleStartCommandInput`, awaits the use case, maps the output DTO to the HTTP reply.
  - Non-`/start` messages preserve the existing flow (identity resolution -> enqueue -> ack).
- [x] Update `src/interfaces/http/routes/telegram.webhook.spec.ts` with `/start` scenarios:
  - `/start` triggers welcome message without enqueuing.
  - Non-`/start` messages continue to enqueue as before.
- [x] Update `src/main.ts` to instantiate `TelegramMessengerAdapter` and `HandleStartCommand`, inject them into the route dependencies.
- [x] Remove the `@ts-expect-error TODO: inject TelegramAdapter when implemented` comment in `main.ts`.
- [x] Run `pnpm test` to verify all tests pass.
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next Step

All phases are complete. Update the corresponding user-story task files (`T-0.01-04.md` and `T-0.01-05.md`) to check off acceptance criteria that were satisfied, then commit the changes.
