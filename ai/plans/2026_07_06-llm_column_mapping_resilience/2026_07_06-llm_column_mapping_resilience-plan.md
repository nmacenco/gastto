# LLM-powered column mapping resilience

## Goal

Make the onboarding column-mapping flow resilient to non-standard spreadsheets by detecting header rows beyond row 1 and falling back to an LLM when rule-based inference is uncertain, fails to find headers, or the user rejects the proposal.

## Context

- `src/application/use-cases/spreadsheet/InferColumnMapping.ts`: currently assumes headers are in `preview.rows[0]` and sample rows are `preview.rows.slice(1, 10)`.
- `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts`: `fetchPreview` reads the fixed range `!1:10`.
- `src/infrastructure/adapters/sheets/RuleBasedColumnInferenceAdapter.ts`: performs dictionary, fuzzy, and content-type matching on the single provided header row.
- `src/domain/ports/columnInference.ts`: defines the stable `ColumnInferencePort`.
- `src/domain/ports/services.ts`: defines `LLMPort`, already implemented by `OpenAIAdapter` and `ClaudeAdapter`.
- `src/application/use-cases/spreadsheet/CorrectColumnMapping.ts`: handles user corrections after a mapping proposal.
- Existing env vars `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are sufficient; no new env vars are required.
- Relevant docs: `docs/features/infer-and-propose-column-mapping.md`, `docs/features/confirm-or-correct-column-mapping.md`, `docs/features/validate-spreadsheet-access.md`.

## Phases

### Phase 1: Rule-based header-row detection

Find the correct header row without LLM cost or latency. This alone fixes the reported case (headers in row 5) for most simple spreadsheets.

To-do:
- [x] Add new domain port `HeaderDetectionPort` in `src/domain/ports/headerDetection.ts`:
  ```ts
  interface HeaderDetectionPort {
    detectHeaderRow(rows: Row[]): Promise<number | null>; // 1-based sheet row index, null if uncertain
  }
  ```
- [x] Implement `RuleBasedHeaderDetectionAdapter` in `src/infrastructure/adapters/sheets/RuleBasedHeaderDetectionAdapter.ts`. It scans the first N rows and returns the first row whose values look like labels rather than data (numeric, date, or currency).
- [x] Extend `GoogleSheetsAdapter.fetchPreview` to read range `!1:20` instead of `!1:10`, providing more context and sample rows.
- [x] Update `InferColumnMapping` to depend on `HeaderDetectionPort`, detect the header row, then extract headers and sample rows for `ColumnInferencePort`.
- [x] Add tests for `RuleBasedHeaderDetectionAdapter` and update `InferColumnMapping.spec.ts` and `GoogleSheetsAdapter.spec.ts`.
- [x] Run `pnpm lint` and `pnpm typecheck`.
- [x] Ask the user if they want to review the changes before continuing.

Public contracts:
- New domain port: `HeaderDetectionPort`.
- New adapter: `RuleBasedHeaderDetectionAdapter`.
- Modified use case: `InferColumnMappingDeps` gains `headerDetectionPort`.
- Modified adapter: `GoogleSheetsAdapter.fetchPreview` range change.
- New/updated test suites.

### Phase 2: LLM header-row fallback

When the rule-based detector cannot confidently locate headers, ask the LLM.

To-do:
- [x] Implement `LLMHeaderDetectionAdapter` in `src/infrastructure/adapters/sheets/LLMHeaderDetectionAdapter.ts`, implementing `HeaderDetectionPort`. It calls `LLMPort.generateResponse` with a structured prompt and parses the JSON response defensively.
- [x] Update `InferColumnMapping` to try `RuleBasedHeaderDetectionAdapter` first and fall back to `LLMHeaderDetectionAdapter` when the rule-based result is `null`.
- [x] Add the LLM prompt template and JSON schema for header-row detection.
- [x] Add tests for `LLMHeaderDetectionAdapter` and update `InferColumnMapping.spec.ts`.
- [x] Run `pnpm lint` and `pnpm typecheck`.
- [x] Ask the user if they want to review the changes before continuing.

Public contracts:
- New adapter: `LLMHeaderDetectionAdapter`.
- Modified use case: `InferColumnMapping` orchestrates rule-based -> LLM header detection.
- New/updated test suites.

### Phase 3: LLM column-inference fallback + user-rejection re-inference

Improve mapping quality for ambiguous or non-dictionary column names, and re-run inference with LLM when the user says the proposal is wrong.

To-do:
- [x] Implement `LLMColumnInferenceAdapter` in `src/infrastructure/adapters/sheets/LLMColumnInferenceAdapter.ts`, implementing `ColumnInferencePort`. It calls `LLMPort.generateResponse` with a structured prompt and parses the JSON mapping.
- [x] Update `InferColumnMapping` to use a hybrid strategy:
  - Run `RuleBasedColumnInferenceAdapter` first.
  - If unmapped fields remain or any mapping has low confidence, run `LLMColumnInferenceAdapter` on the detected header row + samples and merge results.
- [x] Update `CorrectColumnMapping` to re-run inference with `LLMColumnInferenceAdapter` when the user rejects the proposal without giving a specific correction.
- [x] Add tests for `LLMColumnInferenceAdapter` and updated flows in `InferColumnMapping.spec.ts` and `CorrectColumnMapping.spec.ts`.
- [x] Update `docs/features/infer-and-propose-column-mapping.md` and `docs/features/confirm-or-correct-column-mapping.md` to document the hybrid behavior.
- [x] Run `pnpm lint` and `pnpm typecheck`.
- [x] Ask the user if they want to review the changes before continuing.

Public contracts:
- New adapter: `LLMColumnInferenceAdapter`.
- Modified use case: `InferColumnMapping` supports hybrid rule-based + LLM inference.
- Modified use case: `CorrectColumnMapping` triggers LLM re-inference on user rejection.
- Updated feature documentation.
- New/updated test suites.

## Design decisions

1. **LLM integration approach**: new adapters (`LLMHeaderDetectionAdapter`, `LLMColumnInferenceAdapter`) implement the existing domain ports and internally call `LLMPort.generateResponse`. This keeps `LLMPort` generic and avoids widening its contract.

2. **Preview range**: `!1:20` to leave room for headers in later rows and still capture enough sample rows.

3. **LLM model selection**: the new adapters receive an already constructed `LLMPort` instance in their constructor. `main.ts` decides whether to inject `OpenAIAdapter` or `ClaudeAdapter`.

4. **User rejection handling**: the LLM re-inference trigger lives in `CorrectColumnMapping`, which already owns the interpretation of user responses after a mapping proposal.

## Next step

All phases are complete. Review the full implementation, run the ship checks (`pnpm lint && pnpm typecheck && pnpm test`), and decide whether to commit the changes.
