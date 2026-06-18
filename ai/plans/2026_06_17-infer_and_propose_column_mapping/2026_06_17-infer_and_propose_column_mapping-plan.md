# Plan: Infer and Propose Column Mapping

## 🎯 Goal

Implement the backend building blocks for HU-4.05 "Infer and propose column mapping": define the domain inference contract, persist inferred column mappings via Drizzle, and build a rule-based inference engine that supports the five Gherkin scenarios.

## 👀 Context

- User story: [`docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.05-infer-and-propose-column-mapping/HU-4.05 — Infer and propose column mapping.md`](docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.05-infer-and-propose-column-mapping/HU-4.05 — Infer and propose column mapping.md)
- Tasks to implement:
  - [`T-4.05-01.md`](docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.05-infer-and-propose-column-mapping/tasks/T-4.05-01.md)
  - [`T-4.05-02.md`](docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.05-infer-and-propose-column-mapping/tasks/T-4.05-02.md)
  - [`T-4.05-03.md`](docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.05-infer-and-propose-column-mapping/tasks/T-4.05-03.md)
- Existing domain types: [`src/domain/entities/SpreadsheetConfig.ts`](src/domain/entities/SpreadsheetConfig.ts) (`GasttoField`, `ColumnMapping`)
- Existing repository port: [`src/domain/ports/repositories.ts`](src/domain/ports/repositories.ts) (`IColumnMappingRepository`)
- Existing FSM: [`src/domain/entities/ConversationState.ts`](src/domain/entities/ConversationState.ts)
- Existing repo pattern: [`src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.ts`](src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.ts) + its `.spec.ts`
- Existing adapter pattern: [`src/infrastructure/adapters/sheets/`](src/infrastructure/adapters/sheets/)
- Existing consumer of mappings: [`src/application/use-cases/expense/RegisterExpense.ts`](src/application/use-cases/expense/RegisterExpense.ts) (line 188 uses `mapping.GasttoField`)
- Relevant docs: `docs/plans/plan-conventions.md`, `docs/adr/adr.md` (ADR-003, ADR-004), `docs/architecture/data-model.md`, `docs/testing/guidelines.md`

## 🪜 Phases

### Phase 1: Domain contracts and persistence

**Description:** Define the domain inference contract (`ColumnInferencePort`, `ColumnInferenceResult`, `ConfidenceLevel`), add the FSM self-transition for `ONBOARDING_MAPPING`, and implement the Drizzle column mapping repository. This phase establishes the contracts and persistence layer that the inference engine will depend on.

**To-do actions:**
- [x] Create `src/domain/ports/columnInference.ts` exporting `ConfidenceLevel`, `ColumnInferenceResult`, and `ColumnInferencePort`.
- [x] Update `FSM_TRANSITIONS` in `src/domain/entities/ConversationState.ts` to add `ONBOARDING_MAPPING → ONBOARDING_MAPPING` self-transition.
- [x] Create `src/domain/entities/ConversationState.spec.ts` with tests for the new self-transition (`canTransition('ONBOARDING_MAPPING', 'ONBOARDING_MAPPING')` returns `true`).
- [x] Create `src/infrastructure/db/repositories/DrizzleColumnMappingRepository.ts` implementing `IColumnMappingRepository` with `findBySpreadsheetId`, `upsertMany`, and `confirm`.
- [x] Create `src/infrastructure/db/repositories/DrizzleColumnMappingRepository.spec.ts` following the pattern in `DrizzleSpreadsheetConfigRepository.spec.ts`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Inference engine and documentation

**Description:** Implement the rule-based column inference engine that covers the five Gherkin scenarios from the user story, create the canonical feature documentation, and sync the task files.

**To-do actions:**
- [x] Create `src/infrastructure/adapters/sheets/RuleBasedColumnInferenceAdapter.ts` implementing `ColumnInferencePort` with:
  - Header normalization (lowercase, trim, NFD unaccent, collapse whitespace).
  - Multi-language dictionaries (ES/EN/PT) mapping synonyms to `GasttoField` values.
  - Levenshtein distance for fuzzy matching (threshold ≥ 0.75).
  - Confidence scoring (`'alta'` for exact/synonym, `'baja'` for fuzzy).
  - No-header detection heuristics.
  - Content-type validation (date/numeric patterns).
- [x] Create `src/infrastructure/adapters/sheets/RuleBasedColumnInferenceAdapter.spec.ts` covering all five Gherkin scenarios from the user story.
- [x] Create `docs/features/infer-and-propose-column-mapping.md` following the template in `docs/features/TEMPLATE.md`.
- [x] Update `docs/features/README.md` to include the new feature doc in the index.
- [x] Check off the acceptance criteria in `T-4.05-01.md`, `T-4.05-02.md`, and `T-4.05-03.md`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## ⏭️ Next step

All phases are complete. The backend building blocks for HU-4.05 "Infer and propose column mapping" have been implemented:

- Domain inference contract (`ColumnInferencePort`, `ColumnInferenceResult`, `ConfidenceLevel`)
- FSM self-transition for `ONBOARDING_MAPPING`
- Drizzle column mapping repository (`DrizzleColumnMappingRepository`)
- Rule-based inference engine (`RuleBasedColumnInferenceAdapter`) with multi-language support, fuzzy matching, and content-type validation
- Feature documentation and task file updates

The next logical step would be to implement T-4.05-05 (the integration use case that wires the inference engine into the onboarding flow and presents the proposed mapping to the user).
