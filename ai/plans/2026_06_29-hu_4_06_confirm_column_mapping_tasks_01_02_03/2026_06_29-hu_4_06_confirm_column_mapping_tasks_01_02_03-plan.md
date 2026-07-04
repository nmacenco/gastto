# Plan: HU-4.06 Tasks 01–03 — Confirm Column Mapping Foundation

## Goal

Create the domain model, persistence ports, and the "confirm mapping" use case that allow a user to accept the column mapping proposed by the system and advance from `ONBOARDING_MAPPING` to `ONBOARDING_CATEGORIES`.

## Context

This plan covers the first three tasks of [`HU-4.06 — Confirm or correct column mapping`](../../../docs/user-stories/01-mvp/01-Vinculación%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.06-confirm-or-correct-column-mapping/HU-4.06%20%E2%80%94%20Confirm%20or%20correct%20column%20mapping.md):

- `T-4.06-01`: Define domain model for column mapping confirmation and correction state.
- `T-4.06-02`: Define application ports for mapping persistence and column listing.
- `T-4.06-03`: Implement confirm column mapping use case.

Relevant existing code:

- Domain entities: [`src/domain/entities/SpreadsheetConfig.ts`](../../../src/domain/entities/SpreadsheetConfig.ts) (already defines `ColumnMapping` and `GasttoField`), [`src/domain/entities/ConversationState.ts`](../../../src/domain/entities/ConversationState.ts) (FSM states and transitions).
- Domain ports: [`src/domain/ports/repositories.ts`](../../../src/domain/ports/repositories.ts) (`IColumnMappingRepository`, `IConversationStateRepository`).
- Existing use case to mirror: [`src/application/use-cases/spreadsheet/InferColumnMapping.ts`](../../../src/application/use-cases/spreadsheet/InferColumnMapping.ts).
- Infrastructure: [`src/infrastructure/db/repositories/DrizzleColumnMappingRepository.ts`](../../../src/infrastructure/db/repositories/DrizzleColumnMappingRepository.ts), [`src/infrastructure/db/schema/index.ts`](../../../src/infrastructure/db/schema/index.ts).
- User-facing copies: [`src/application/copies/onboarding.copies.ts`](../../../src/application/copies/onboarding.copies.ts).
- Worker wiring: [`src/interfaces/workers/message.worker.ts`](../../../src/interfaces/workers/message.worker.ts).
- Composition root: [`src/main.ts`](../../../src/main.ts).

Documentation consulted:

- [`docs/plans/plan-conventions.md`](../../../docs/plans/plan-conventions.md)
- [`docs/adr/ADR-003-fsm-postgresql.md`](../../../docs/adr/ADR-003-fsm-postgresql.md)
- [`docs/adr/ADR-014-fsm-eager-advance.md`](../../../docs/adr/ADR-014-fsm-eager-advance.md)
- [`docs/features/infer-and-propose-column-mapping.md`](../../../docs/features/infer-and-propose-column-mapping.md)
- [`docs/features/conversation-state-management.md`](../../../docs/features/conversation-state-management.md)
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md)

## Phases

### Phase 1: Domain model and persistence ports

Create the transient correction-state value object and extend the repository/column ports so the confirm and future correction use cases have clean boundaries.

Public contracts created or modified in this phase:

- Domain value object: `ColumnMappingCorrectionState` in `src/domain/value-objects/ColumnMappingCorrectionState.ts`.
  - Holds the original proposed mapping, accumulated corrections, and a status marker (`proposed` | `correcting` | `confirmed`).
  - Remains immutable and free of infrastructure concerns.
- Domain port `IColumnMappingRepository` in `src/domain/ports/repositories.ts`.
  - Add `confirmBySpreadsheetId(spreadsheetId: string): Promise<void>`.
  - Add `updateCorrected(mapping: Partial<ColumnMapping> & { id: string }): Promise<void>` to prepare for `T-4.06-05`.
- Domain port `ISpreadsheetColumnPort` in `src/domain/ports/spreadsheetColumns.ts`.
  - Declares `listAvailableColumns(...): Promise<AvailableColumn[]>` for future column validation.
- Infrastructure: update `DrizzleColumnMappingRepository` to implement the new repository methods.

To-do:

- [x] Create `src/domain/value-objects/ColumnMappingCorrectionState.ts` with the value object, factory methods, and an `applyCorrection` operation.
- [x] Create `src/domain/value-objects/ColumnMappingCorrectionState.spec.ts` with pure domain tests.
- [x] Extend `IColumnMappingRepository` in `src/domain/ports/repositories.ts` with `confirmBySpreadsheetId` and `updateCorrected`.
- [x] Create `src/domain/ports/spreadsheetColumns.ts` with `ISpreadsheetColumnPort` and the `AvailableColumn` type.
- [x] Implement the new methods in `src/infrastructure/db/repositories/DrizzleColumnMappingRepository.ts`.
- [x] Add or update unit/integration tests for `DrizzleColumnMappingRepository` covering batch confirm and corrected update.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Confirm column mapping use case

Implement the use case that finalizes the mapping when the user confirms it, wires it into the composition root, and covers it with unit tests.

Public contracts created or modified in this phase:

- Application use case: `ConfirmColumnMapping` in `src/application/use-cases/spreadsheet/ConfirmColumnMapping.ts`.
  - Inputs: `userId`, `externalId`, `channel`, `statePayload`.
  - Output: `nextState`, `message`, optional `payload`.
- Application copies: add `mappingConfirmedNextStep` in `src/application/copies/onboarding.copies.ts`.
- Composition root: wire `ConfirmColumnMapping` in `src/main.ts`.
- Tests: `src/application/use-cases/spreadsheet/ConfirmColumnMapping.spec.ts`.

To-do:

- [x] Create `src/application/use-cases/spreadsheet/ConfirmColumnMapping.ts` with `ConfirmColumnMappingInput`, `ConfirmColumnMappingOutput`, `ConfirmColumnMappingDeps`, and the `execute` method.
- [x] In the use case:
  - Load the spreadsheet config from `statePayload` or `ISpreadsheetConfigRepository`.
  - Load proposed mappings via `IColumnMappingRepository.findBySpreadsheetId`.
  - Confirm them via `IColumnMappingRepository.confirmBySpreadsheetId`.
  - Clear correction state from the payload.
  - Transition to `ONBOARDING_CATEGORIES` via `TransitionConversationState`.
  - Return the next-step message.
- [x] Add `mappingConfirmedNextStep` copy to `src/application/copies/onboarding.copies.ts`.
- [x] Wire `ConfirmColumnMapping` into `src/main.ts` so it can be injected into the message worker later (T-4.06-07).
- [x] Create `src/application/use-cases/spreadsheet/ConfirmColumnMapping.spec.ts` covering:
  - Happy path: mappings are confirmed, state transitions, confirmation message is sent.
  - No proposed mappings: appropriate error/message, no transition.
  - Repository failure: no message is sent, error propagates.
  - Transition failure: mappings remain unconfirmed, error propagates.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All planned phases are complete. Continue with `T-4.06-04` (natural-language correction parser) to enable per-field mapping corrections, or commit the changes delivered by this plan.
