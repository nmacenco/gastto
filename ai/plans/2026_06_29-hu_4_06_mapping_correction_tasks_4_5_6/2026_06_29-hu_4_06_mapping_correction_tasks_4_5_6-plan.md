# Plan: HU-4.06 tasks 4, 5, 6 — Mapping correction parser, use case, and Redis state

## Goal

Implement the natural-language correction parser, the single-field correction use case with column validation, and the Redis-backed mapping correction state adapter for HU-4.06. Keep the existing PostgreSQL-based FSM store untouched; persist only the transient mapping-correction state in Redis with a configurable 30-minute TTL.

## Context

- User story: `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.06-confirm-or-correct-column-mapping/HU-4.06 — Confirm or correct column mapping.md`
- Tasks covered by this plan: **T-4.06-04**, **T-4.06-05**, **T-4.06-06**.
- Prerequisites already implemented:
  - T-4.06-01: `ColumnMappingCorrectionState` value object in `src/domain/value-objects/ColumnMappingCorrectionState.ts`.
  - T-4.06-02: `IColumnMappingRepository`, `IConversationStateRepository`, and `ISpreadsheetColumnPort` ports in `src/domain/ports/repositories.ts` and `src/domain/ports/spreadsheetColumns.ts`.
  - T-4.06-03: `ConfirmColumnMapping` use case in `src/application/use-cases/spreadsheet/ConfirmColumnMapping.ts`.
- Related existing code:
  - `src/application/use-cases/spreadsheet/InferColumnMapping.ts` (displays the initial proposal).
  - `src/interfaces/workers/message.worker.ts` currently re-runs `InferColumnMapping` for every `ONBOARDING_MAPPING` message and does not distinguish confirmation from correction.
  - `src/domain/ports/spreadsheetColumns.ts` defines `ISpreadsheetColumnPort.listAvailableColumns` for column validation.
- Architectural constraint: ADR-003 (`docs/adr/ADR-003-fsm-postgresql.md`) and `docs/features/conversation-state-management.md` mandate that the conversation FSM state lives in PostgreSQL and Redis is used only for identity cache and BullMQ.

> Note on T-4.06-06 wording: the task literally says "implement the `ConversationStateRepository` application port" in Redis. This plan follows the architecture-compliant interpretation: introduce a dedicated `IMappingCorrectionStateRepository` port for the transient correction state, implement it in Redis, and leave the main FSM repository (`DrizzleConversationStateRepository`) in PostgreSQL.

## Phases

### Phase 1: Implement natural-language correction parser (T-4.06-04)

Add a deterministic, dependency-free parser that extracts `{ field, columnRef }` from messages such as "no, the category is in column E". Keep it isolated behind a small interface so an LLM-based adapter can replace it later without touching the use case.

Public contracts created/modified:
- New application service: `ColumnMappingCorrectionParser` with `parse(message: string): CorrectionParseResult`.
- New DTOs: `CorrectionParseSuccess` (`{ kind: 'success'; field: GasttoField; columnRef: string }`) and `CorrectionParseFailure` (`{ kind: 'failure'; reason: string }`).

To-do:
- [x] Create `src/application/services/ColumnMappingCorrectionParser.ts`.
- [x] Define the `CorrectionParseResult` union and its members.
- [x] Implement regex/rules-based extraction supporting Spanish/English field synonyms (category, amount, date, description, payment method, currency) and column references (letter, number, header name).
- [x] Return an explicit failure when the message does not contain a recognizable correction.
- [x] Run lint and typecheck on the new file. No issues found; `pnpm typecheck` passes globally.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Unit tests for the correction parser

Cover the parser with pure unit tests. No mocks are needed because the parser has no external dependencies.

Public contracts created/modified:
- New test suite: `src/application/services/ColumnMappingCorrectionParser.spec.ts`.

To-do:
- [x] Create `src/application/services/ColumnMappingCorrectionParser.spec.ts`.
- [x] Test successful parsing for common Spanish/English phrasings ("la categoría está en E", "column F is the date", etc.).
- [x] Test letter, number, and header-name column references.
- [x] Test explicit failure for messages without recognizable corrections.
- [x] Verify every `GasttoField` value can be recognized by at least one synonym.
- [x] Run `pnpm lint` and `pnpm typecheck`; all 27 parser tests pass.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Implement CorrectColumnMapping use case (T-4.06-05)

Build the application use case that applies a single user correction, validates the referenced column against the spreadsheet, accumulates corrections, and returns the updated mapping for re-confirmation.

Public contracts created/modified:
- New use case: `CorrectColumnMapping` with `execute(input): CorrectColumnMappingOutput`.
- New repository port: `IMappingCorrectionStateRepository` (`save`, `load`, `clear`) defined in `src/domain/ports/repositories.ts`.
- Modified worker: `src/interfaces/workers/message.worker.ts` to route confirmation vs. correction vs. first-entry messages in `ONBOARDING_MAPPING`.
- New copies: `onboardingCopies.mappingUpdatedConfirmation`, `onboardingCopies.invalidColumnPrompt`, `onboardingCopies.resumeMappingCorrection`.

To-do:
- [x] Create `src/application/use-cases/spreadsheet/CorrectColumnMapping.ts`.
- [x] Define `CorrectColumnMappingInput` and `CorrectColumnMappingOutput` DTOs (valid correction, invalid column, parse failure, missing mapping).
- [x] Load the proposed mappings from `IColumnMappingRepository` via the user's `SpreadsheetConfig`.
- [x] Parse the user message with `ColumnMappingCorrectionParser`.
- [x] Call `ISpreadsheetColumnPort.listAvailableColumns` to validate the parsed column reference.
- [x] On valid correction, apply it through `ColumnMappingCorrectionState`, persist the updated correction state via `IMappingCorrectionStateRepository`, and return the full updated mapping.
- [x] On invalid column, return the list of available columns without persisting the correction.
- [x] On parse failure or missing proposed mapping, return the appropriate error/reconnect message.
- [x] Add new copy functions in `src/application/copies/onboarding.copies.ts`.
- [x] Update `src/interfaces/workers/message.worker.ts` so the `ONBOARDING_MAPPING` branch routes confirm intent to `ConfirmColumnMapping`, correction intent to `CorrectColumnMapping`, and first entry (no `mappings` in payload) to `InferColumnMapping`.
- [x] Add `correctColumnMapping` to `MessageWorkerDeps` and wire it in `src/main.ts` with a temporary in-memory correction-state repository.
- [x] Run `pnpm lint` and `pnpm typecheck`; full test suite (635 tests) passes.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.
### Phase 4: Unit tests for CorrectColumnMapping

Test the use case in isolation with mocked ports, following `docs/testing/guidelines.md`.

Public contracts created/modified:
- New test suite: `src/application/use-cases/spreadsheet/CorrectColumnMapping.spec.ts`.

To-do:

- [x] Create `src/application/use-cases/spreadsheet/CorrectColumnMapping.spec.ts`.
- [x] Build typed mocks for `IColumnMappingRepository`, `ISpreadsheetConfigRepository`, `ISpreadsheetColumnPort`, `IMappingCorrectionStateRepository`, `MessagingOutputPort`, and `TransitionConversationState`.
- [x] Test valid single-field correction returns updated mapping, sends confirmation copy, and persists correction state.
- [x] Test cumulative corrections for multiple fields replace earlier corrections for the same field.
- [x] Test invalid column reference returns available columns and does not persist the correction.
- [x] Test parse failure leaves state unchanged and returns a helpful copy.
- [x] Test missing spreadsheet config or mapping triggers the reconnect flow.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.
### Phase 5: Implement Redis mapping correction state adapter (T-4.06-06)

Add an Infrastructure adapter that serializes the correction state to Redis with a configurable TTL. This satisfies HU-4.06 Scenario 5 (30-minute abandonment/resume) without moving the FSM state out of PostgreSQL.

Public contracts created/modified:
- New adapter: `RedisMappingCorrectionStateRepository` implementing `IMappingCorrectionStateRepository`.
- New env var: `MAPPING_CORRECTION_TTL_SECONDS` in `src/config/env.schema.ts` with default `1800` (30 minutes).

To-do:

- [x] Create `src/infrastructure/redis/RedisMappingCorrectionStateRepository.ts`.
- [x] Implement `save(userId, state, ttlSeconds)` using Redis `SETEX` with key `conversation:{userId}:mapping-correction`.
- [x] Implement `load(userId)` using Redis `GET`; deserialize JSON safely and return `null` when missing or expired.
- [x] Implement `clear(userId)` using Redis `DEL`.
- [x] Add `MAPPING_CORRECTION_TTL_SECONDS` to `src/config/env.schema.ts` and read it in `src/main.ts` when wiring the adapter.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.
### Phase 6: Unit tests for Redis adapter

Test the Redis adapter by mocking the `ioredis` client interface.

Public contracts created/modified:
- New test suite: `src/infrastructure/redis/RedisMappingCorrectionStateRepository.spec.ts`.

To-do:

- [x] Create `src/infrastructure/redis/RedisMappingCorrectionStateRepository.spec.ts`.
- [x] Mock Redis `get`, `setex`, and `del` methods with `vi.fn()`.
- [x] Test save/load round-trip serializes and deserializes `ColumnMappingCorrectionState` correctly.
- [x] Test `load` returns `null` when the key is missing.
- [x] Test `save` passes the TTL in seconds to Redis.
- [x] Test `clear` deletes the key.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.
### Phase 7: Wire adapter and use case into production runtime

Connect the Redis correction-state adapter to `CorrectColumnMapping` and the message worker so the feature is end-to-end usable.

Public contracts created/modified:
- Modified bootstrap: `src/main.ts` instantiates `RedisMappingCorrectionStateRepository` and injects it into `CorrectColumnMapping`.
- Modified worker deps: `MessageWorkerDeps.correctColumnMapping` populated in production.

To-do:

- [x] Update `src/main.ts` to instantiate `RedisMappingCorrectionStateRepository` with the shared `Redis` client and the TTL from config.
- [x] Pass the repository into the `CorrectColumnMapping` constructor.
- [x] Ensure `createMessageWorker` receives `correctColumnMapping` in `src/main.ts`.
- [x] Run `pnpm test` and fix any failing tests.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.
### Phase 8: Documentation and final verification

Add the canonical feature doc, update indexes, and run the full ship check.

Public contracts created/modified:
- New doc: `docs/features/confirm-or-correct-column-mapping.md`.
- Updated index: `docs/features/README.md`.
- Updated task files: `T-4.06-04.md`, `T-4.06-05.md`, `T-4.06-06.md`.

To-do:

- [x] Create `docs/features/confirm-or-correct-column-mapping.md` describing behavior, FSM flow, public contracts, and error handling.
- [x] Update `docs/features/README.md` to link the new doc.
- [x] After implementation, check the acceptance-criteria boxes in `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.06-confirm-or-correct-column-mapping/tasks/T-4.06-04.md`, `T-4.06-05.md`, and `T-4.06-06.md`.
- [x] Run `pnpm lint && pnpm typecheck && pnpm test` and ensure everything passes.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases of this plan are complete. The implementation covers T-4.06-04, T-4.06-05, and T-4.06-06. Consider exporting this conversation and storing it as `ai/plans/2026_06_29-hu_4_06_mapping_correction_tasks_4_5_6/2026_06_29-hu_4_06_mapping_correction_tasks_4_5_6-conversation.md` next to the plan.
