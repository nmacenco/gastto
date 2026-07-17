# Fix no-header step leak into mapping proposal

## Goal

Eliminate the post-mapping-confirmation loop that occurs when the `ONBOARDING_MAPPING` state payload keeps `step: 'no-header'` after a successful column-mapping proposal. Once a proposal exists, confirmation/correction intents must take precedence over the no-header row prompt.

## Context

- `src/application/use-cases/spreadsheet/InferColumnMapping.ts` builds the proposal payload by spreading `statePayload`, which leaks `step: 'no-header'` when the proposal was triggered from the no-header reply flow.
- `src/application/use-cases/spreadsheet/CorrectColumnMapping.ts` has the same leak on rejection re-inference.
- `src/interfaces/workers/message.worker.ts` runs `handleNoHeaderResponse` before `handleMappingConfirmation`, so the leaked step causes every reply (including "sí") to be parsed as a data-start row number.
- `src/application/use-cases/spreadsheet/InferColumnMapping.spec.ts`, `src/application/use-cases/spreadsheet/CorrectColumnMapping.spec.ts`, and `src/interfaces/workers/message.worker.spec.ts` cover the sub-flows individually, but none cover no-header -> proposal -> confirm.
- `docs/features/infer-and-propose-column-mapping.md` and `docs/features/confirm-or-correct-column-mapping.md` document the FSM payloads and should reflect that a successful inference clears the no-header step.

## Phases

### Phase 1 — Clean the no-header step from proposal payloads and cover the full flow with tests

- [x] In `src/application/use-cases/spreadsheet/InferColumnMapping.ts`, remove `step` from the proposal payload returned/transitional after successful inference. Keep `mappings`, `unmappedFields`, `provider`, `fileId`, `sheetName`, and `preview`.
- [x] In `src/application/use-cases/spreadsheet/CorrectColumnMapping.ts`, apply the same cleanup on successful rejection re-inference.
- [x] Add a unit test in `src/application/use-cases/spreadsheet/InferColumnMapping.spec.ts` that passes a payload with `step: 'no-header'` and asserts the returned payload has no `step` when mappings are proposed.
- [x] Add a unit test in `src/application/use-cases/spreadsheet/CorrectColumnMapping.spec.ts` that passes a payload with `step: 'no-header'` during rejection re-inference and asserts the returned payload has no `step` when mappings are re-proposed.
- [x] Add a test in `src/interfaces/workers/message.worker.spec.ts` that sets the FSM payload to `{ step: 'no-header', mappings: [...], ... }`, sends a confirm intent, and asserts that `ConfirmColumnMapping.execute` is called and the no-header re-prompt is not sent.
- [x] Update `docs/features/infer-and-propose-column-mapping.md` Scenario 4 to state that a successful inference after a no-header reply clears `step: 'no-header'` from the payload.
- [x] Update `docs/features/confirm-or-correct-column-mapping.md` Scenario 6 to state that successful rejection re-inference clears `step: 'no-header'` from the payload.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Public contracts

### Application services

- `InferColumnMapping.execute(input: InferColumnMappingInput): Promise<InferColumnMappingOutput>` — same signature; returned `payload` no longer contains `step: 'no-header'` when a mapping proposal is produced.
- `CorrectColumnMapping.execute(input: CorrectColumnMappingInput): Promise<CorrectColumnMappingOutput>` — same signature; returned `payload` no longer contains `step: 'no-header'` when re-inferred mappings are produced.

### Test suites

- `src/application/use-cases/spreadsheet/InferColumnMapping.spec.ts` — new test: "clears step no-header from payload when proposing mappings".
- `src/application/use-cases/spreadsheet/CorrectColumnMapping.spec.ts` — new test: "clears step no-header from payload when re-inferred mappings are proposed".
- `src/interfaces/workers/message.worker.spec.ts` — new test: "confirms mapping proposal even when payload still carries step no-header".

### Text copies

- No new copies. The existing `invalidDataStartRowPrompt` copy should only appear when the user is genuinely expected to provide a data-start row.

### Database schemas

- No changes.

## Next step

All phases completed; run the full test suite with `pnpm test` and ask the user if they want to commit the changes.
