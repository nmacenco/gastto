# Goal

Centralize all user-facing text strings into a dedicated `src/application/copies/` module to improve maintainability, test stability, and future i18n support. No functional behaviour or API contracts change.

# Context

User-visible strings are currently scattered across multiple files, making translations and consistent tone hard to manage. The affected files are:

- `src/application/use-cases/spreadsheet/InitiateCloudConnection.ts`: provider prompt, invalid re-prompt, coming-soon message, auth link.
- `src/interfaces/workers/message.worker.ts`: onboarding placeholder, clarification questions, expense summary, confirmation/cancellation messages.
- `src/application/use-cases/conversation/HandleStartCommand.ts`: welcome message.
- `src/application/use-cases/conversation/HandleUnsupportedMessage.ts`: unsupported message copy.

Their corresponding test files assert exact string values, so any copy change breaks tests:

- `src/application/use-cases/spreadsheet/InitiateCloudConnection.spec.ts`
- `src/interfaces/workers/message.worker.spec.ts`
- `src/application/use-cases/conversation/HandleStartCommand.spec.ts`
- `src/application/use-cases/conversation/HandleUnsupportedMessage.spec.ts`

The new copies module will live under `src/application/copies/` with three files:

- `onboarding.copies.ts`: strings for provider selection and OAuth flow.
- `expense.copies.ts`: strings for expense clarification, review, saving, and cancellation.
- `shared.copies.ts`: generic strings such as welcome, unsupported message, and onboarding placeholder.
- `index.ts`: public barrel export.

# Phases

## Phase 1: Create copies module and migrate onboarding / shared strings

- [x] Create `src/application/copies/onboarding.copies.ts` with functions for provider prompt, invalid re-prompt, coming-soon, auth link, and onboarding placeholder.
- [x] Create `src/application/copies/shared.copies.ts` with functions for welcome message (with optional username) and unsupported message.
- [x] Create `src/application/copies/index.ts` exporting all copy functions.
- [x] Refactor `InitiateCloudConnection.ts` to import and use `onboarding.copies` functions. Remove local string constants.
- [x] Refactor `HandleStartCommand.ts` to import and use `shared.copies` welcome function. Remove inline welcome string.
- [x] Refactor `HandleUnsupportedMessage.ts` to import and use `shared.copies` unsupported function. Remove `UNSUPPORTED_MESSAGE_COPY` constant.
- [x] Update `InitiateCloudConnection.spec.ts`, `HandleStartCommand.spec.ts`, and `HandleUnsupportedMessage.spec.ts` to reference copy functions instead of literal strings.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 2: Migrate expense and worker strings

- [x] Create `src/application/copies/expense.copies.ts` with functions for clarification questions (amount, currency), saving, cancelled, confirmation prompt, fallback error, and summary formatting.
- [x] Refactor `message.worker.ts` to import and use copies functions for:
  - clarification questions (`¿Cuánto gastaste?`, `¿En qué moneda fue ese gasto?`)
  - onboarding placeholder
  - expense summary header and confirmation prompt
  - saving message
  - cancellation message
  - ambiguous response prompt
  - fallback error message
- [x] Update `message.worker.spec.ts` to reference copy functions instead of literal strings for all affected assertions.
- [x] Run `pnpm test` to ensure all test suites pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

# Next step

All phases complete. No further implementation needed.
