# Feature: Send Responses to the User

## Purpose

Provide a reliable, channel-agnostic mechanism for sending text messages back to users via Telegram (and eventually WhatsApp). The feature ensures that responses are delivered even in the presence of transient Telegram API failures, long messages, or invalid chat states.

## Behavior (Implemented)

- The `TelegramMessengerAdapter` implements the application-layer `MessagingOutputPort`.
- `sendMessage(chatId, text)` returns a discriminated `SendResult`:
  - `{ status: 'success' }` on successful delivery.
  - `{ status: 'failure', errorCode: string }` on any failure, without throwing.
- **Retry logic:** On HTTP 5xx errors, the adapter retries up to 3 times with exponential backoff delays of 1s, 2s, and 4s.
- **Permanent failures:** HTTP 400 and 403 errors return `PERMANENT_FAILURE` immediately with no retries.
- **Message chunking:** Texts exceeding Telegram's 4096-character limit are automatically split into sequential fragments and sent to the same `chat_id`.
  - Splitting prefers `\n\n` (paragraph boundaries), then `. ` (sentence boundaries), then hard cut at 4096 characters.
  - If any fragment fails permanently, remaining fragments are not sent and the operation returns failure.
- **Structured logging:** Every send attempt is logged with `event: 'message_sent'` containing `chatId`, `textLength`, `attempt`, and `result`. Permanent failures use `console.error` with `event: 'message_send_failed'` containing `chatId`, `textLength`, `errorCode`, and `reason`. Retry scheduling is logged with `event: 'retry_scheduled'`. Message chunking is logged with `event: 'message_chunked'`.
- No stack traces are leaked to clients or external systems.

## Behavior (TODO)

- WhatsApp sender adapter (future epic).
- Idempotency key support for strict duplicate prevention on retry.

## API / Interface

- `MessagingOutputPort.sendMessage(chatId: string, text: string): Promise<SendResult>` — Application-layer output port owned by `src/application/ports/output/messaging.port.ts`.
- `IChatMessenger.sendWelcome(chatId: string, username?: string): Promise<void>` — Application-layer port for onboarding welcome messages.
- `TelegramMessengerAdapter` — Infrastructure implementation located at `src/infrastructure/adapters/telegram/TelegramMessengerAdapter.ts`.

## Data Model

No database schema changes. The feature operates on transient API calls and value objects:

- `SendResult` — discriminated union (`SendResultSuccess | SendResultFailure`).
- `TelegramSendMessageBody` — JSON body shape `{ chat_id: string; text: string }` sent to `POST https://api.telegram.org/bot<token>/sendMessage`.

## Tests

- [x] `TelegramMessengerAdapter.spec.ts` — successful single message send returns `SendResultSuccess` and logs correctly.
- [x] `TelegramMessengerAdapter.spec.ts` — message longer than 4096 chars is split; each fragment is sent; logging confirms fragments.
- [x] `TelegramMessengerAdapter.spec.ts` — HTTP 5xx triggers 3 retries with correct delays (using `vi.useFakeTimers()`), then returns `SendResultFailure` with `MAX_RETRIES_EXCEEDED`.
- [x] `TelegramMessengerAdapter.spec.ts` — HTTP 400/403 returns `PERMANENT_FAILURE` immediately with no retries.
- [x] `TelegramMessengerAdapter.spec.ts` — fragment permanent failure stops remaining fragments.
- [x] `TelegramMessengerAdapter.spec.ts` — logging spy confirms structured `console.log` and `console.error` calls for all scenarios.
- [x] `messaging.port.spec.ts` — contract tests for `SendResult` discriminated union.

## Related User Stories

- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.03-send-responses-to-the-user/HU-0.03 — Send responses to the user.md`

## Notes

- The legacy domain-level `MessagingPort` (returning `Promise<void>`) was removed in favor of the application-level `MessagingOutputPort` (returning `Promise<SendResult>`). This aligns with Clean Architecture: the Application layer owns the port contract.
- A temporary wrapper in `src/main.ts` that bridged the legacy adapter to `MessagingOutputPort` was deleted once the adapter was upgraded.
- The `message.worker.ts` thick worker now depends on `MessagingOutputPort` instead of the legacy `MessagingPort`.
