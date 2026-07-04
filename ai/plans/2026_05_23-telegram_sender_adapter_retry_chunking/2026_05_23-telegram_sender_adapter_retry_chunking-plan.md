# Plan: Refactor Telegram sender adapter with retry, chunking, and logging

## Goal

Refactor the TelegramMessengerAdapter to implement the Application-layer `MessagingOutputPort`, add exponential backoff retry for server-side failures and automatic message chunking for texts exceeding Telegram's 4096-character limit, and integrate structured logging with full unit test coverage.

## Context

This plan completes the remaining tasks for **HU-0.03 — Send responses to the user** (T-0.03-02 through T-0.03-06). Task T-0.03-01 (define `MessagingOutputPort`) is already implemented.

Key files and contracts to consider:

- `src/application/ports/output/messaging.port.ts`: Defines `MessagingOutputPort` and the `SendResult` discriminated union (T-0.03-01, already done).
- `src/infrastructure/adapters/telegram/TelegramMessengerAdapter.ts`: Current adapter implementing `IChatMessenger` and the domain-level `MessagingPort` (returns `Promise<void>`). Needs to be upgraded to `MessagingOutputPort`.
- `src/infrastructure/adapters/telegram/TelegramMessengerAdapter.spec.ts`: Existing unit tests for the adapter. Must be expanded to cover retry, chunking, and logging.
- `src/main.ts`: Contains a temporary wrapper that bridges the legacy `Promise<void>` adapter to `MessagingOutputPort`. This wrapper must be removed and the adapter wired directly.
- `src/interfaces/workers/message.worker.ts`: Currently depends on the domain `MessagingPort`. Must be updated to use the application `MessagingOutputPort` so the adapter can be injected cleanly.
- `src/domain/ports/services.ts`: Defines the legacy `MessagingPort` interface. Will become unused after the migration and can be removed.
- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.03-send-responses-to-the-user/`: Canonical user story and task files.

Architecture and conventions from `AGENTS.md`:

- Clean Architecture: Application layer owns the port; Infrastructure provides the implementation.
- Adapter pattern: Keep the adapter in `src/infrastructure/adapters/telegram/`.
- Observability: `console.error` with structured objects; no stack traces leaked to clients.
- Testing: Vitest, mock at boundaries, meaningful assertions (no filler tests).
- `pnpm lint && pnpm typecheck && pnpm test` must pass green before each phase can be considered complete.

## Phases

### Phase 1: Refactor adapter to implement MessagingOutputPort

**Description:** Upgrade `TelegramMessengerAdapter` from the domain `MessagingPort` to the application `MessagingOutputPort`. Change `sendMessage` to return `Promise<SendResult>`, remove the temporary wrapper from `main.ts`, and migrate the message worker to the canonical port. Update existing tests for the new return type.

**Public contracts modified:**

- `TelegramMessengerAdapter` class: `sendMessage` signature changes from `Promise<void>` to `Promise<SendResult>`. The adapter now implements `MessagingOutputPort` instead of `MessagingPort`.
- `main.ts`: DI wiring for `MessagingOutputPort` - the temporary wrapper is deleted and `telegramAdapter` is passed directly.
- `message.worker.ts`: `messagingAdapters` record type changes from `MessagingPort` to `MessagingOutputPort`.

**Public contracts deleted:**

- Temporary `messagingOutputPort` wrapper object in `main.ts`.

**To-do actions:**

- [x] Update `TelegramMessengerAdapter` to implement `MessagingOutputPort` (from `src/application/ports/output/messaging.port`).
- [x] Change `sendMessage` to return `Promise<SendResult>`:
  - On HTTP 2xx and Telegram `ok: true`, return `{ status: 'success' }`.
  - On HTTP non-2xx or Telegram `ok: false`, return `{ status: 'failure', errorCode: 'SEND_FAILED' }` (or a more specific code if available, e.g., `TELEGRAM_API_ERROR`).
- [x] Remove the `implements MessagingPort` clause from `TelegramMessengerAdapter` and delete the `options` parameter from `sendMessage`.
- [x] Update `main.ts`:
  - Remove the temporary `messagingOutputPort` wrapper.
  - Pass `telegramAdapter` directly wherever `MessagingOutputPort` is required (`handleUnsupportedMessage`, `routeIncomingMessage`).
- [x] Update `message.worker.ts`:
  - Import `MessagingOutputPort` from the Application layer.
  - Change `messagingAdapters` record type from `MessagingPort` to `MessagingOutputPort`.
  - Adjust any call sites if necessary (the method signature is compatible: same params, just a different return type).
- [x] Optionally remove the now-unused `MessagingPort` and `SendMessageOptions` from `src/domain/ports/services.ts`.
- [x] Update `TelegramMessengerAdapter.spec.ts` to assert on the new `SendResult` return type instead of `.rejects.toThrow()`.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Retry logic and automatic message chunking

**Description:** Add exponential backoff retry for HTTP 5xx errors and permanent failure handling for HTTP 400/403. Implement automatic splitting of messages longer than 4096 characters into sequential fragments.

**Public contracts created:**

- Internal retry helper (e.g., `withRetry` or inline logic inside the adapter). Not a public contract per se, but a key behavioral contract of the adapter.
- Message chunking helper (e.g., `splitMessage` or `chunkText`). Splitting strategy: prefer `\n\n`, then `. `, then hard cut at 4096 chars.

**Public contracts modified:**

- `TelegramMessengerAdapter.sendMessage` behavior:
  - HTTP 5xx -> retries exactly 3 times with delays of 1s, 2s, and 4s.
  - HTTP 400/403 -> immediate permanent failure, no retries.
  - Text length > 4096 -> split into fragments of <= 4096 chars and send sequentially. Each fragment uses the same retry logic.
  - If any fragment fails permanently, the remaining fragments are not sent and the overall operation returns failure.

**To-do actions:**

- [x] Implement retry logic in `TelegramMessengerAdapter` (or via a small private helper):
  - On any HTTP 5xx status, wait and retry up to 3 times.
  - Delays: 1s (first retry), 2s (second retry), 4s (third retry). Use `setTimeout`/`sleep`.
  - On HTTP 400 or 403, return `{ status: 'failure', errorCode: 'PERMANENT_FAILURE' }` immediately.
  - After exhausting retries, return `{ status: 'failure', errorCode: 'MAX_RETRIES_EXCEEDED' }` without throwing.
- [x] Implement message chunking:
  - If `text.length <= 4096`, send a single API call.
  - If `text.length > 4096`, split into fragments:
    - First try to split on `\n\n` (paragraph boundaries).
    - Then try `. ` (sentence boundaries).
    - Fall back to hard cut at 4096 characters.
  - Each fragment must be `<= 4096` chars.
  - Send fragments sequentially to the same `chat_id`, reusing the retry-enabled sender for each fragment.
  - If a fragment fails permanently, stop sending subsequent fragments and return failure.
- [x] Add minimal logging for retry and chunking events (placeholder for Phase 3).
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Structured logging and comprehensive unit tests

**Description:** Integrate structured logging for all send operations and expand the test suite to cover success, retry, chunking, permanent failures, and logging assertions.

**Public contracts modified:**

- `TelegramMessengerAdapter` logging behavior:
  - `console.log({ event: 'message_sent', chatId, textLength, attempt, result })` on every completed send (success or final failure).
  - `console.error({ event: 'message_send_failed', chatId, textLength, errorCode, reason })` on permanent failures.

**Public contracts created:**

- `TelegramMessengerAdapter.spec.ts` test suite (expanded):
  - Test: successful single message send returns `SendResultSuccess` and logs correctly.
  - Test: message longer than 4096 chars is split; each fragment is sent; logging confirms fragments.
  - Test: HTTP 5xx triggers 3 retries with correct delays, then returns `SendResultFailure`.
  - Test: HTTP 400/403 returns failure immediately with no retries.
  - Test: fragment permanent failure stops remaining fragments.
  - Test: logging spy confirms structured `console.log` and `console.error` calls for all scenarios.

**To-do actions:**

- [x] Add structured logging to `TelegramMessengerAdapter`:
  - Log every send attempt with `chatId`, `textLength`, `attempt` number, and final `result`.
  - Log permanent failures with `console.error` and a structured object containing `event`, `chatId`, `textLength`, `errorCode`, and `reason`.
  - Ensure no stack traces are leaked outside internal logs.
- [x] Expand `TelegramMessengerAdapter.spec.ts`:
  - Mock `fetch` and `globalThis.fetch` (Vitest `vi.fn()`).
  - Use `vi.useFakeTimers()` to test backoff delays without real sleeps.
  - Cover all scenarios from the public contracts above.
  - Use `vi.spyOn(console, 'log')` and `vi.spyOn(console, 'error')` to verify structured logging.
- [x] Run `pnpm test` and verify all tests pass.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. Update the corresponding user-story task files under `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.03-send-responses-to-the-user/tasks/` by checking off the acceptance criteria checkboxes that were satisfied, and commit the changes.
