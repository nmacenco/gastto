# Plan: Define Messaging Output Port Interface

## Goal

Create the application-level output port interface and discriminated result type for sending messages to users, keeping use cases agnostic of Telegram. Migrate existing use cases from the domain-layer `MessagingPort` to this new application-layer port.

## Context

- `src/domain/ports/services.ts`: Contains the existing domain-layer `MessagingPort` with `sendMessage(externalId, text, options?) → Promise<void>`. This port mixes parse-mode options that leak Telegram concepts into the domain layer.
- `src/application/ports/IChatMessenger.ts`: Existing application port limited to `sendWelcome(chatId, username?) → Promise<void>`.
- `src/application/use-cases/conversation/RouteIncomingMessage.ts` and `HandleUnsupportedMessage.ts`: Both currently depend on the domain-layer `MessagingPort`.
- `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts` and `HandleUnsupportedMessage.spec.ts`: Tests mock the domain port returning `void`.
- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.03-send-responses-to-the-user/tasks/T-0.03-01.md`: The canonical task requiring an application output port with a discriminated `SendResult`.
- `AGENTS.md`: Defines the layer boundaries (Application owns output ports; Infrastructure implements them) and the Done Gates (`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Phases

### Phase 1: Define the `SendResult` discriminated union and `MessagingOutputPort` interface

Create the application-level output port under `src/application/ports/output/` so the Application layer owns the contract. The port must declare a method that returns a discriminated `SendResult` union, clearly separating success from failure without exposing Telegram-specific errors.

- [x] Create directory `src/application/ports/output/`.
- [x] Create `src/application/ports/output/messaging.port.ts` containing:
  - `SendResultSuccess` with `status: 'success'`.
  - `SendResultFailure` with `status: 'failure'` and `errorCode: string`.
  - `SendResult` union type.
  - `MessagingOutputPort` interface with `sendMessage(chatId: string, text: string): Promise<SendResult>`.
- [x] Create `src/application/ports/index.ts` as a barrel export for application ports (re-export `MessagingOutputPort` and `SendResult`).
- [x] Create `src/application/ports/output/messaging.port.spec.ts` with contract-level tests verifying:
  - The `SendResult` union narrows correctly on `status`.
  - `MessagingOutputPort` has the expected method signature.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Migrate use cases from `MessagingPort` to `MessagingOutputPort`

Update the two application use cases that currently consume the domain-layer `MessagingPort` so they depend on the newly created application-layer `MessagingOutputPort`. Update their unit tests to mock the new discriminated return type.

- [x] Update `HandleUnsupportedMessage.ts`: change constructor-injected port from `MessagingPort` to `MessagingOutputPort`; update `execute` to handle the new `Promise<SendResult>` return type (ignore the result for this fire-and-forget handler, but keep the `.catch` behavior).
- [x] Update `HandleUnsupportedMessage.spec.ts`: change the mock `sendMessage` to return `Promise<{ status: 'success' }>` instead of `Promise<void>`; keep the rejection test case.
- [x] Update `RouteIncomingMessage.ts`: change `RouteIncomingMessageDeps.messagingPort` type from `MessagingPort` to `MessagingOutputPort`; keep the existing fire-and-forget `.catch` logic.
- [x] Update `RouteIncomingMessage.spec.ts`: change the mock `sendMessage` to return `Promise<{ status: 'success' }>` instead of `Promise<void>`; keep the rejection test case.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases completed. Proceed to Task T-0.03-02: implement the concrete Telegram HTTP sender adapter that satisfies the `MessagingOutputPort` interface.
