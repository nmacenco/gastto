# Plan: Implement Telegram Payload Parser, Message Router, and Unsupported Message Handler

## Goal

Extract the inline parsing, routing, and unsupported-type handling logic from the Fastify webhook route into dedicated Clean Architecture components: an Infrastructure parser adapter, an Application router use case, and an Application unsupported-message handler.

## Context

### Relevant documentation

- `docs/plans/plan-conventions.md`: Structure and conventions for plan files.
- `docs/testing/guidelines.md`: Unit test placement, mocking rules, coverage minimums.
- `AGENTS.md`: Architecture directory layout, DB conventions, documentation sync rules, ship check.

### Existing code to consider

- `src/domain/value-objects/MessageType.ts`: Discriminated union `'TEXT' | 'UNSUPPORTED' | 'MALFORMED'`.
- `src/domain/value-objects/IncomingMessage.ts`: Immutable value object for text messages; validates required fields at construction time.
- `src/domain/ports/messaging.ts`: `NormalizedPayload` interface — the contract between Infrastructure adapters and Application use cases.
- `src/domain/ports/services.ts`: `MessagingPort` interface for sending responses back to users.
- `src/interfaces/http/routes/telegram.webhook.ts`: Fastify handler that currently performs inline parsing (Zod schema), unsupported-type detection, malformed-payload logging, and routing. This file will be refactored to delegate all business logic to the new Application use case.
- `src/interfaces/http/routes/telegram.webhook.spec.ts`: Existing contract tests for the webhook route. Will be updated after refactoring.
- `src/infrastructure/adapters/telegram/TelegramMessengerAdapter.ts`: Existing adapter implementing `MessagingPort` and `IChatMessenger`.

### Current behavior

The webhook route (`telegram.webhook.ts`) currently:

1. Parses the raw Telegram payload with an inline Zod schema.
2. Returns HTTP 200 for unparseable payloads (prevents Telegram retry loops).
3. Detects non-text messages and sends a fallback Spanish copy inline.
4. Routes `/start` to `HandleStartCommand`.
5. Enqueues everything else into BullMQ.

The objective is to move steps 1-3 out of the route layer and into dedicated components while preserving the existing HTTP-contract and behavior.

## Phases

### Phase 1: Implement Telegram Payload Parser (T-0.02-02)

Build an Infrastructure adapter that receives the raw JSON payload from the Telegram webhook and maps it to the domain `NormalizedPayload` contract.

- [x] Create `src/infrastructure/adapters/telegram/TelegramPayloadParser.ts`.
  - Export a `parse(payload: unknown): NormalizedPayload` function (or class method).
  - On valid text message: return `NormalizedPayload` with `messageType: 'TEXT'`, `chatId`, `userId`, `text`, `timestamp`, `channel: 'telegram'`.
  - On valid payload but missing `text` (photo, audio, sticker, etc.): return `NormalizedPayload` with `messageType: 'UNSUPPORTED'`, `chatId`, `timestamp`, `channel: 'telegram'`. `userId` and `text` should be `undefined`.
  - On malformed / unparseable payload: return `NormalizedPayload` with `messageType: 'MALFORMED'`, `chatId: 'unknown'`, `timestamp: new Date()`, `channel: 'telegram'`, and include `rawPayload` for observability.
  - Never throw; always return a `NormalizedPayload`.
- [x] Create `src/infrastructure/adapters/telegram/TelegramPayloadParser.spec.ts`.
  - Happy path: standard Telegram text payload maps to `TEXT` with correct fields.
  - Missing `text` but valid structure maps to `UNSUPPORTED`.
  - Completely invalid / missing `message` maps to `MALFORMED` with `rawPayload` preserved.
  - Optional: audio, photo, sticker payloads map to `UNSUPPORTED`.
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Public contracts created / modified:**

- Application services: None.
- Domain events: None.
- Test suites: `TelegramPayloadParser.spec.ts` (new).
- Database schemas: None.
- Text copies: None.

---

### Phase 2: Implement Router and Unsupported Message Handler (T-0.02-03 + T-0.02-04)

Create the Application-layer router use case and unsupported-message handler, then refactor the Fastify webhook route to delegate to them.

- [x] Create `src/application/use-cases/conversation/RouteIncomingMessage.ts`.
  - Accept a `NormalizedPayload` and an output port (`MessagingPort`).
  - Routing logic:
    - `TEXT`: enqueue BullMQ job (preserve existing behavior) and send acknowledgment.
    - `UNSUPPORTED`: delegate to `HandleUnsupportedMessage`.
    - `MALFORMED`: log the raw payload via `console.error` with a structured object (`{ endpoint, code, userId? }`) and return without sending any user message.
  - The use case must remain agnostic of Telegram; it only knows the domain `NormalizedPayload` and `MessagingPort`.
- [x] Create `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts`.
  - Mock `MessagingPort` and message queue.
  - `TEXT`: verify enqueue is called and ack message is sent.
  - `UNSUPPORTED`: verify `HandleUnsupportedMessage` path is invoked (mock the handler dependency).
  - `MALFORMED`: verify no enqueue, no message sent, and logger called.
- [x] Create `src/application/use-cases/conversation/HandleUnsupportedMessage.ts`.
  - Accept `chatId: string` and `MessagingPort`.
  - Send the exact copy: `"For now I only process text messages. Tell me about your expense by typing it."`.
  - Does not throw or log errors.
- [x] Create `src/application/use-cases/conversation/HandleUnsupportedMessage.spec.ts`.
  - Verify the exact copy is passed to `sendMessage`.
  - Verify no error is thrown.
- [x] Refactor `src/interfaces/http/routes/telegram.webhook.ts`.
  - Replace inline Zod parsing with a call to `TelegramPayloadParser.parse()`.
  - Replace inline unsupported-type handling with a call to `RouteIncomingMessage.execute()`.
  - Remove the inline `TelegramUpdateSchema` Zod schema if no longer needed (parser owns the schema now).
  - Ensure the route handler still:
    - Returns HTTP 200 for all cases (prevents Telegram retries).
    - Handles `/start` short-circuit before routing (or moves it into the router — either is fine as long as the behavior is preserved).
    - Keeps origin validation middleware untouched.
- [x] Update `src/interfaces/http/routes/telegram.webhook.spec.ts`.
  - Adjust mocks to inject the parser and router instead of testing inline logic.
  - Preserve all existing assertions: 200 for unparseable, 200 for unsupported with correct message, valid text message flow, `/start` flow.
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Public contracts created / modified:**

- Application services:
  - `RouteIncomingMessage.execute(payload: NormalizedPayload): Promise<void>` (new).
  - `HandleUnsupportedMessage.execute(chatId: string): Promise<void>` (new).
- Domain events: None.
- Test suites:
  - `RouteIncomingMessage.spec.ts` (new).
  - `HandleUnsupportedMessage.spec.ts` (new).
  - `telegram.webhook.spec.ts` (updated).
- Database schemas: None.
- Text copies:
  - Unsupported message response updated from Spanish (`"Por ahora solo proceso mensajes de texto. Contame tu gasto escribiendolo."`) to English (`"For now I only process text messages. Tell me about your expense by typing it."`). This is a public user-facing contract.

## Next Step

All phases are complete. Consider committing the changes and updating the task files under `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.02-receive-parse-and-route-incoming-messages/tasks/` to mark T-0.02-02, T-0.02-03, and T-0.02-04 as done.
