# Plan: Infer Column Mapping Use Case and Worker Wiring

## Goal

Implement the `InferColumnMapping` application use case that orchestrates the column mapping inference flow (T-4.05-05), persist the spreadsheet preview in the FSM state payload so the use case can extract headers without re-reading the sheet (T-4.05-04), and wire the new use case into the message worker for the `ONBOARDING_MAPPING` FSM state (T-4.05-06).

## Context

- User story: [`HU-4.05 — Infer and propose column mapping`](docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.05-infer-and-propose-column-mapping/HU-4.05 — Infer and propose column mapping.md)
- Tasks to implement:
  - [`T-4.05-04.md`](docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.05-infer-and-propose-column-mapping/tasks/T-4.05-04.md) (Persist spreadsheet preview in ONBOARDING_MAPPING payload)
  - [`T-4.05-05.md`](docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.05-infer-and-propose-column-mapping/tasks/T-4.05-05.md) (Implement InferColumnMapping use case)
  - [`T-4.05-06.md`](docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.05-infer-and-propose-column-mapping/tasks/T-4.05-06.md) (Wire ONBOARDING_MAPPING in message worker)
- Already implemented (previous plan):
  - [`src/domain/ports/columnInference.ts`](src/domain/ports/columnInference.ts) - `ColumnInferencePort`, `ColumnInferenceResult`, `ConfidenceLevel`
  - [`src/infrastructure/adapters/sheets/RuleBasedColumnInferenceAdapter.ts`](src/infrastructure/adapters/sheets/RuleBasedColumnInferenceAdapter.ts) - rule-based inference engine
  - [`src/infrastructure/db/repositories/DrizzleColumnMappingRepository.ts`](src/infrastructure/db/repositories/DrizzleColumnMappingRepository.ts) - persistence
  - FSM self-transition for `ONBOARDING_MAPPING` already in place
- Key files to modify:
  - [`src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts`](src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts) - add `preview` to payload on success
  - [`src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.spec.ts`](src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.spec.ts) - update tests
  - [`src/application/copies/onboarding.copies.ts`](src/application/copies/onboarding.copies.ts) - add mapping proposal copies
  - [`src/interfaces/workers/message.worker.ts`](src/interfaces/workers/message.worker.ts) - add `ONBOARDING_MAPPING` case
  - [`src/interfaces/workers/message.worker.spec.ts`](src/interfaces/workers/message.worker.spec.ts) - add tests
  - [`src/main.ts`](src/main.ts) - instantiate and inject `InferColumnMapping`
- Reference patterns:
  - [`src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts`](src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts) - use case pattern
  - [`src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts`](src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts) - use case pattern
  - [`src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.ts`](src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.ts) - repository pattern
- Existing domain types:
  - [`src/domain/entities/SpreadsheetConfig.ts`](src/domain/entities/SpreadsheetConfig.ts) - `GasttoField`, `ColumnMapping`, `SpreadsheetConfig`
  - [`src/domain/entities/SpreadsheetPreview.ts`](src/domain/entities/SpreadsheetPreview.ts) - `SpreadsheetPreview`
  - [`src/domain/ports/repositories.ts`](src/domain/ports/repositories.ts) - `IOAuthTokenRepository`, `ISpreadsheetConfigRepository`, `IColumnMappingRepository`
  - [`src/domain/ports/tokenEncryption.ts`](src/domain/ports/tokenEncryption.ts) - `TokenEncryptionPort`
- Relevant docs: `docs/plans/plan-conventions.md`, `docs/adr/adr.md`, `docs/features/validate-spreadsheet-access.md`, `docs/features/infer-and-propose-column-mapping.md`, `docs/testing/guidelines.md`

## Phases

### Phase 1: Persist Spreadsheet Preview in ONBOARDING_MAPPING Payload

**Description:** Update the `ValidateSpreadsheetAccess` use case to include the serialized `SpreadsheetPreview` in the FSM state payload when transitioning to `ONBOARDING_MAPPING` on success. This is a small, backward-compatible change that stores the preview so the next use case can extract headers and sample rows without re-reading the sheet.

**To-do actions:**
- [x] Modify `src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts`:
  - In the `handleResult` method, case `'success'`, extract `result.preview` and add it to the `payload` object passed to `transitionState.execute`.
  - Serialize the `SpreadsheetPreview` as a plain object: `{ provider, fileId, sheetName, rows }`.
- [x] Update `src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.spec.ts`:
  - Modify the success test to assert that `payload.preview` is included in the `transitionState.execute` call.
  - Verify the preview shape: `{ provider: 'google', fileId: 'file-123', sheetName: 'Gastos', rows: [...] }`.
- [x] Update `docs/features/validate-spreadsheet-access.md`:
  - In the "Behavior (Implemented)" section, document that the success case stores the `SpreadsheetPreview` in the FSM state payload.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Implement InferColumnMapping Use Case

**Description:** Implement the `InferColumnMapping` application use case that orchestrates the column mapping inference flow. The use case retrieves the OAuth token, loads the spreadsheet config, extracts the preview from the FSM state payload, invokes the inference port, persists the inferred mappings, formats a proposal message using onboarding copies, and sends it via the messaging port. It handles all five Gherkin scenarios from the user story plus error paths.

**To-do actions:**
- [x] Create `src/application/use-cases/spreadsheet/InferColumnMapping.ts`:
  - Define `InferColumnMappingInput`: `{ userId, externalId, channel, statePayload }`.
  - Define `InferColumnMappingOutput`: `{ nextState, message, payload? }`.
  - Define `InferColumnMappingDeps`: `tokenRepository`, `tokenEncryption`, `spreadsheetConfigRepository`, `columnMappingRepository`, `columnInferencePort`, `messagingPort`, `transitionState`.
  - Implement `execute(input)`:
    - Retrieve and decrypt OAuth token (handle missing/expired/revoked/decrypt failure → reconnect message + transition to `ONBOARDING_START`).
    - Load `SpreadsheetConfig` via `spreadsheetConfigRepository.findByUserId(userId)` (handle missing → reconnect message + transition to `ONBOARDING_START`).
    - Extract `preview` from `statePayload` (handle missing → error message + no crash).
    - Extract headers (row 1) and sample rows (rows 2-10) from preview.
    - Invoke `columnInferencePort.infer(headers, sampleRows)`.
    - Persist inferred mappings via `columnMappingRepository.upsertMany()` with `inferred: true` and `confirmedAt: null`.
    - Format proposal message based on scenario:
      - Scenario 1 (high confidence): use `onboardingCopies.mappingProposalHighConfidence()`.
      - Scenario 2 (low confidence): use `onboardingCopies.mappingProposalLowConfidence()`.
      - Scenario 3 (no headers): self-transition to `ONBOARDING_MAPPING` with `step: 'no-header'`, use `onboardingCopies.noHeaderPrompt()`.
      - Scenario 4 (unmapped fields): include omission info using `onboardingCopies.unmappedFieldsNote()`.
    - Send message via `messagingPort.sendMessage()`.
    - Return output with `nextState: 'ONBOARDING_MAPPING'`.
- [x] Update `src/application/copies/onboarding.copies.ts`:
  - Add `mappingProposalHighConfidence(mappings, unmappedFields)`: format message with emoji indicators (📅💰🏷️📝) and "Is this correct?" prompt.
  - Add `mappingProposalLowConfidence(mappings, unmappedFields)`: format message with uncertainty indicator.
  - Add `noHeaderPrompt()`: ask user which row data starts at.
  - Add `unmappedFieldsNote(fields)`: list omitted fields.
  - Add helper to translate `GasttoField` to Spanish labels: `fecha → Fecha`, `monto → Monto`, `categoria → Categoría`, `concepto → Concepto`, `medio_pago → Medio de pago`, `moneda → Moneda`.
- [x] Create `src/application/use-cases/spreadsheet/InferColumnMapping.spec.ts`:
  - Mock all ports: `IOAuthTokenRepository`, `TokenEncryptionPort`, `ISpreadsheetConfigRepository`, `IColumnMappingRepository`, `ColumnInferencePort`, `MessagingOutputPort`, `TransitionConversationState`.
  - Test Scenario 1 (high confidence): message includes emoji indicators, mappings persisted with `inferred: true`, `confirmedAt: null`.
  - Test Scenario 2 (low confidence): message includes uncertainty indicator.
  - Test Scenario 3 (no headers): self-transition to `ONBOARDING_MAPPING` with `step: 'no-header'`, message asks which row data starts at.
  - Test Scenario 4 (unmapped fields): message lists omitted fields.
  - Test Scenario 5 (multi-language headers): ES/EN/PT headers recognized and mapped correctly.
  - Test error paths: token missing/expired/revoked/decrypt failure → reconnect message + transition to `ONBOARDING_START`.
  - Test error paths: missing spreadsheet config → reconnect message + transition to `ONBOARDING_START`.
  - Test error paths: missing preview in payload → error message, no crash.
  - Verify no imports from Infrastructure or Interfaces layers.
- [x] Update `docs/features/infer-and-propose-column-mapping.md`:
  - Move implemented behaviors from "Behavior (TODO)" to "Behavior (Implemented)".
  - Update "API / Interface" section to document `InferColumnMapping` use case.
  - Update "Tests" section to mark completed tests.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Wire ONBOARDING_MAPPING in Message Worker

**Description:** Add `InferColumnMapping` to `MessageWorkerDeps` and replace the placeholder in `message.worker.ts` for the `ONBOARDING_MAPPING` case. The worker delegates to the use case, keeping all business logic in the Application layer. Instantiate and inject the use case in the composition root (`main.ts`).

**To-do actions:**
- [x] Update `src/interfaces/workers/message.worker.ts`:
  - Add `inferColumnMapping?: InferColumnMapping | null` to `MessageWorkerDeps` interface.
  - Import `InferColumnMapping` type.
  - Split the `ONBOARDING_MAPPING` case from `ONBOARDING_CATEGORIES` (currently grouped together).
  - In the `ONBOARDING_MAPPING` case: if `opts.inferColumnMapping` is provided, call `opts.inferColumnMapping.execute({ userId, externalId, channel, statePayload: conversationState?.statePayload ?? null })`. Otherwise, fall back to `messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder())`.
  - Keep `ONBOARDING_CATEGORIES` with the placeholder fallback.
- [x] Update `src/interfaces/workers/message.worker.spec.ts`:
  - Add mock for `InferColumnMapping.execute`.
  - Add test: `ONBOARDING_MAPPING` delegates to `InferColumnMapping` when wired.
  - Add test: `ONBOARDING_MAPPING` falls back to placeholder when `inferColumnMapping` is not wired.
  - Verify the worker passes `userId`, `externalId`, `channel`, and `statePayload` correctly.
- [x] Update `src/main.ts`:
  - Import `InferColumnMapping` use case.
  - Import `DrizzleColumnMappingRepository` (if not already imported).
  - Import `RuleBasedColumnInferenceAdapter` (if not already imported).
  - Instantiate `DrizzleColumnMappingRepository` (if not already instantiated).
  - Instantiate `RuleBasedColumnInferenceAdapter` (if not already instantiated).
  - Instantiate `InferColumnMapping` with all dependencies (when `googleOAuthAdapter !== null`):
    - `tokenRepository: tokenRepo`
    - `tokenEncryption: tokenEncryption`
    - `spreadsheetConfigRepository: spreadsheetConfigRepo`
    - `columnMappingRepository: columnMappingRepo`
    - `columnInferencePort: ruleBasedColumnInferenceAdapter`
    - `messagingPort: telegramAdapter`
    - `transitionState: transitionState`
  - Pass `inferColumnMapping` to `createMessageWorker`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. The implementation of T-4.05-04, T-4.05-05, and T-4.05-06 is finished:

- Phase 1: Persisted `SpreadsheetPreview` in the FSM state payload on successful validation.
- Phase 2: Implemented `InferColumnMapping` use case with all five Gherkin scenarios, error paths, onboarding copies, and unit tests.
- Phase 3: Wired `InferColumnMapping` into the message worker for the `ONBOARDING_MAPPING` FSM state.

The next logical step would be to implement T-4.05-07 (feature doc finalization and FSM transition tests) if not already covered, or proceed to HU-4.06 (confirm/correct column mapping).
