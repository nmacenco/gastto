# Plan: T-0.02-01 — Define domain message types and value objects

## Goal

Create the core domain types that represent an incoming message from any external channel, decoupling Application and Infrastructure layers from Telegram specifics.

## Context

- The project follows Clean Architecture with Domain, Application, Infrastructure, and Interfaces layers (see `AGENTS.md`).
- `src/domain/` currently has entities and ports but no value objects.
- Downstream tasks T-0.02-02 (Telegram payload parser) and T-0.02-03 (message router) depend on these contracts.
- `exactOptionalPropertyTypes` is enabled in `tsconfig.json`; optional properties must explicitly include `| undefined` (see `docs/typescript/explicit-undefined-optional-properties.md`).
- Existing domain ports: `src/domain/ports/services.ts` (LLMPort, SpreadsheetPort, MessagingPort), `src/domain/ports/repositories.ts`.
- The current Telegram webhook route (`src/interfaces/http/routes/telegram.webhook.ts`) uses inline `ProcessMessageJobData` and Zod parsing directly. These new domain contracts will replace that tight coupling.

## Phases

### Phase 1: Create core domain value objects

**Description:** Define `MessageType` discriminated union and `IncomingMessage` immutable value object with validation logic, plus their unit tests.

**Public contracts created:**

- `MessageType` (`src/domain/value-objects/MessageType.ts`): union `'TEXT' | 'UNSUPPORTED' | 'MALFORMED'`.
- `IncomingMessage` (`src/domain/value-objects/IncomingMessage.ts`): immutable class with `readonly chatId`, `readonly userId`, `readonly text`, `readonly timestamp`, `readonly channel: 'telegram' | 'whatsapp'`. Constructor validates required fields (non-empty strings) and throws a domain error for invalid input.
- Test suites:
  - `src/domain/value-objects/IncomingMessage.spec.ts`: constructor validation, immutability, equality.
  - `src/domain/value-objects/MessageType.spec.ts`: type narrowing.

**To-do actions:**

- [x] Create `src/domain/value-objects/MessageType.ts` with the union type.
- [x] Create `src/domain/value-objects/IncomingMessage.ts` with validation in constructor.
- [x] Create `src/domain/value-objects/IncomingMessage.spec.ts` covering valid construction, missing fields, empty strings, and immutability.
- [x] Create `src/domain/value-objects/MessageType.spec.ts` covering type narrowing.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Define NormalizedPayload port and finalize exports

**Description:** Create the `NormalizedPayload` port in `src/domain/ports/messaging.ts` and add barrel exports so upper layers can import cleanly without circular dependencies.

**Public contracts created:**

- `NormalizedPayload` (`src/domain/ports/messaging.ts`): interface with `messageType: MessageType`, `chatId: string`, `userId?: string | undefined`, `text?: string | undefined`, `timestamp: Date`, `channel: 'telegram' | 'whatsapp'`, `rawPayload?: unknown`.
- `src/domain/value-objects/index.ts`: barrel export for value objects.
- Test suites:
  - `src/domain/ports/messaging.spec.ts`: type-level contract assertions and discriminated union narrowing.

**To-do actions:**

- [x] Create `src/domain/ports/messaging.ts` with `NormalizedPayload` interface.
- [x] Add `NormalizedPayload` export to `src/domain/ports/index.ts` (created barrel file).
- [x] Create `src/domain/value-objects/index.ts` barrel file exporting `MessageType` and `IncomingMessage`.
- [x] Create `src/domain/ports/messaging.spec.ts` with type-level contract tests.
- [x] Verify no circular dependencies by running `pnpm test`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Both phases are complete. The domain contracts (`MessageType`, `IncomingMessage`, `NormalizedPayload`) are ready for downstream Task T-0.02-02 (Telegram payload parser adapter).
