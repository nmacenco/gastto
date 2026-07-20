# Plan: Free-text expense intent classifier

## Goal

Implement the domain value object `FreeTextIntent` and the application service `ClassifyFreeTextExpenseIntent` so that incoming free-text messages can be classified as `expense-like`, `non-financial`, or `too-long` before routing in `RouteIncomingMessage`.

## Context

### Relevant files

- `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-01-send-free-text-to-register-an-expense/tasks/T-E1-US-01-01.md`
- `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-01-send-free-text-to-register-an-expense/tasks/T-E1-US-01-02.md`
- `src/domain/value-objects/MessageType.ts`: pattern for small domain unions
- `src/domain/value-objects/IncomingMessage.ts`: pattern for immutable domain value objects with `Object.freeze`
- `src/application/use-cases/conversation/HandleUnsupportedMessage.ts`: reference for a small, single-responsibility application service
- `src/application/use-cases/conversation/RouteIncomingMessage.ts`: the consumer that will later use `ClassifyFreeTextExpenseIntent`
- `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts`: existing test style for conversation use cases
- `src/domain/ports/messaging.ts`: `NormalizedPayload` contract

### Conventions to follow

- `AGENTS.md`: Clean Architecture separation (Domain/Application/Interfaces), Vitest for tests, pnpm scripts
- `docs/plans/plan-conventions.md`: phases as vertical slices, lint/typecheck at the end of each phase
- Domain value objects live in `src/domain/value-objects/`
- Application services live in `src/application/use-cases/conversation/` or `src/application/services/`

## Phases

### Phase 1: Define the `FreeTextIntent` domain contract

**Public contracts created:**

- Domain type: `src/domain/value-objects/FreeTextIntent.ts`
  - Discriminated union type `FreeTextIntent` with variants:
    - `{ kind: 'expense-like' }`
    - `{ kind: 'non-financial' }`
    - `{ kind: 'too-long' }`
  - Exported type guard or narrowing helpers so callers can switch on `kind` exhaustively.

**To-do actions:**

- [x] Create `src/domain/value-objects/FreeTextIntent.ts` with the `FreeTextIntent` union type and narrowing helpers.
- [x] Export the new type from `src/domain/value-objects/index.ts` if the project uses a barrel file.
- [x] Add a minimal type-level spec `src/domain/value-objects/FreeTextIntent.spec.ts` that verifies narrowing in a `switch` statement (similar to `MessageType.spec.ts`).
- [x] Run `pnpm test` and ensure the new spec passes.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Implement the `FreeTextIntent` heuristic factory and tests

**Public contracts created/modified:**

- Domain factory: `FreeTextIntent.fromText(text: string): FreeTextIntent`
  - Length check: text longer than 500 characters returns `too-long`.
  - Expense heuristic: presence of numeric amounts, currency symbols (`$`, `€`, `£`), currency words (`euros`, `dólares`, `pesos`), or expense verbs (`pagado`, `gasté`, `compré`, `paid`, `spent`, `compró`) returns `expense-like`.
  - Default: `non-financial`.
- Test suite: `src/domain/value-objects/FreeTextIntent.spec.ts` expanded with runtime cases.

**To-do actions:**

- [x] Add the static factory method `FreeTextIntent.fromText` to `src/domain/value-objects/FreeTextIntent.ts`.
- [x] Implement the 500-character threshold for `too-long`.
- [x] Implement the heuristic signals for `expense-like` (numbers, currency symbols/words, expense verbs).
- [x] Expand `src/domain/value-objects/FreeTextIntent.spec.ts` with the four acceptance scenarios from E1-US-01:
  - [x] Happy path: `"Pagué el almuerzo, 12 euros"` -> `expense-like`
  - [x] Partial info: `"Almuerzo 12"` -> `expense-like`
  - [x] Non-financial: `"Hola"` / `"👋"` -> `non-financial`
  - [x] Too long: string with more than 500 characters -> `too-long`
- [x] Run `pnpm test` and ensure all tests pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Implement the `ClassifyFreeTextExpenseIntent` application service

**Public contracts created:**

- Application service: `src/application/use-cases/conversation/ClassifyFreeTextExpenseIntent.ts`
  - Method signature: `execute(text: string): FreeTextIntent`
  - No infrastructure or channel dependencies.
- Test suite: `src/application/use-cases/conversation/ClassifyFreeTextExpenseIntent.spec.ts`

**To-do actions:**

- [x] Create `src/application/use-cases/conversation/ClassifyFreeTextExpenseIntent.ts` that wraps `FreeTextIntent.fromText`.
- [x] Ensure the service class has no dependencies other than the domain value object.
- [x] Create `src/application/use-cases/conversation/ClassifyFreeTextExpenseIntent.spec.ts` covering the same four Gherkin scenarios from E1-US-01.
- [x] Follow the existing test style from `RouteIncomingMessage.spec.ts` (Vitest, `describe`/`it`, clear arrange-act-assert).
- [x] Export the service from the conversation use-cases barrel if one exists, or follow existing project conventions.
- [x] Run `pnpm test` and ensure all tests pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Plan complete. Proceed to wire the classifier into `RouteIncomingMessage` and add the guidance response use case and copies (tasks T-E1-US-01-03 and T-E1-US-01-04).
