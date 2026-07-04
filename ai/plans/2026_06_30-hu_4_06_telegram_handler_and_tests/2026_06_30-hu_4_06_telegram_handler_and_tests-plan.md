# Plan: HU-4.06 Telegram handler and tests for confirm/correct column mapping

## Goal

Wire the existing `ConfirmColumnMapping` and `CorrectColumnMapping` use cases into the Telegram message-worker pipeline, implement the abandonment/resume prompt, and complete the unit-test coverage for HU-4.06 so that `T-4.06-07` and `T-4.06-08` can be marked done.

## Context

- Feature specification: `docs/features/confirm-or-correct-column-mapping.md`
- User story: `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.06-confirm-or-correct-column-mapping/HU-4.06 — Confirm or correct column mapping.md`
- Task files:
  - `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.06-confirm-or-correct-column-mapping/tasks/T-4.06-07.md`
  - `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.06-confirm-or-correct-column-mapping/tasks/T-4.06-08.md`
- Existing use cases:
  - `src/application/use-cases/spreadsheet/ConfirmColumnMapping.ts`
  - `src/application/use-cases/spreadsheet/CorrectColumnMapping.ts`
- Parser: `src/application/services/ColumnMappingCorrectionParser.ts`
- Redis adapter: `src/infrastructure/redis/RedisMappingCorrectionStateRepository.ts`
- Message worker (routing layer): `src/interfaces/workers/message.worker.ts`
- Message worker tests: `src/interfaces/workers/message.worker.spec.ts`
- Telegram webhook: `src/interfaces/http/routes/telegram.webhook.ts`
- Application wiring: `src/main.ts`
- Text copies: `src/application/copies/onboarding.copies.ts`
- Testing guidelines: `docs/testing/guidelines.md`

## Public contracts

### Application services

- `ConfirmColumnMapping.execute(input: ConfirmColumnMappingInput): Promise<ConfirmColumnMappingOutput>` - no signature change.
- `CorrectColumnMapping.execute(input: CorrectColumnMappingInput): Promise<CorrectColumnMappingOutput>` - no signature change; may add a `resume-prompt` output kind if resume logic is pushed into the use case.

### Test suites

- `src/interfaces/workers/message.worker.spec.ts`: add `ONBOARDING_MAPPING` routing tests for confirmation, correction, infer fallback, and list-columns intent.
- `src/application/use-cases/spreadsheet/ConfirmColumnMapping.spec.ts`: add negative assertions for repository failure ordering (if not already covered).
- `src/application/use-cases/spreadsheet/CorrectColumnMapping.spec.ts`: add resume flow tests if resume logic lives in the use case.
- `src/application/services/ColumnMappingCorrectionParser.spec.ts`: add extra Spanish/English phrasing cases required by T-4.06-08.

### Text copies

- New `onboardingCopies.mappingResumePrompt(snapshot): string` asking the user whether to continue from the saved correction state.

### Database schemas / domain events

- No changes.

## Phases

### Phase 1: Basic confirm/correct routing in the message worker

**Description:** Make the `ONBOARDING_MAPPING` branch in `message.worker.ts` fully delegate to the confirm and correct use cases, cover the routing with unit tests, and handle an explicit "list columns" intent.

- [x] Add `confirmColumnMapping` and `correctColumnMapping` typed mocks to `src/interfaces/workers/message.worker.spec.ts`.
- [x] Add worker tests:
  - [x] Confirm intent (`sí`, `ok`, `correcto`, etc.) with an existing `mappings` payload calls `ConfirmColumnMapping.execute`.
  - [x] Non-confirm message with an existing `mappings` payload calls `CorrectColumnMapping.execute`.
  - [x] No `mappings` payload calls `InferColumnMapping.execute`.
  - [x] When only `inferColumnMapping` is wired, the placeholder copy is not sent.
  - [x] A "list columns" / "mostrar columnas" message is routed to `CorrectColumnMapping` (or handled explicitly) so the available columns are returned.
- [x] In `message.worker.ts`, ensure the `ONBOARDING_MAPPING` branch uses `isConfirmIntent` first, then falls back to correction, then to inference.
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Abandonment/resume prompt

**Description:** Implement the resume behavior required by HU-4.06 Scenario 5: when the user returns after the Redis TTL has expired (or a saved snapshot exists but the FSM payload was reset), ask whether to continue from the saved state.

- [x] Choose the resume implementation boundary:
  - Option A (recommended): keep resume logic in the message worker. If `ONBOARDING_MAPPING` has no `mappings` payload but `IMappingCorrectionStateRepository.load(userId)` returns a snapshot, send `mappingResumePrompt` and transition to `ONBOARDING_MAPPING` with `{ step: 'resume', snapshot }`.
  - Option B: push resume logic into `CorrectColumnMapping` by adding a `resume-prompt` output kind.
- [x] Add the new copy `onboardingCopies.mappingResumePrompt(snapshot)` in `src/application/copies/onboarding.copies.ts`.
- [x] Implement the prompt flow:
  - [x] On resume prompt, a confirm intent loads the snapshot, rebuilds the current mapping, and sends the updated mapping for confirmation.
  - [x] A decline/cancel intent clears the Redis snapshot and falls back to `InferColumnMapping` (original proposal).
- [x] Add unit tests for the resume flow in the chosen layer.
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Full unit-test coverage and task closure

**Description:** Close the test gaps for the parser and use cases, verify the whole suite passes, and update the backlog task files.

- [x] Extend `src/application/services/ColumnMappingCorrectionParser.spec.ts` with the additional phrasings required by T-4.06-08 (at least 3+ variants per field).
- [x] Add a parser/use-case integration test in `CorrectColumnMapping.spec.ts` that uses the real parser instead of a mocked one for the happy path.
- [x] Add negative assertions required by `docs/testing/guidelines.md`:
  - [x] If `CorrectColumnMapping` correction state save fails, no confirmation message is sent and no state transition occurs.
  - [x] If `ConfirmColumnMapping` repository confirmation fails, no message is sent.
- [x] Run `pnpm test`, `pnpm lint`, and `pnpm typecheck`. Fix failures until green.
- [x] Update the acceptance-criteria checkboxes in:
  - [x] `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.06-confirm-or-correct-column-mapping/tasks/T-4.06-07.md`
  - [x] `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.06-confirm-or-correct-column-mapping/tasks/T-4.06-08.md`
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. Export this conversation and store it as `ai/plans/2026_06_30-hu_4_06_telegram_handler_and_tests/2026_06_30-hu_4_06_telegram_handler_and_tests-conversation.md`, then commit the changes if desired.
