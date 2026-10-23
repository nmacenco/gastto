# Subcategory Spreadsheet Mapping and Pair Detection

## Goal

Add `subcategoria` as an optional spreadsheet mapping field and provide safe, provider-independent extraction of linked category/subcategory pairs. This work must preserve category-only mapping and onboarding behavior and must not yet persist detected hierarchies or change expense saving.

## Context

- [`src/domain/entities/SpreadsheetConfig.ts`](../../../src/domain/entities/SpreadsheetConfig.ts): Current six-value `GasttoField` union and persisted column-mapping entity.
- [`src/domain/ports/columnInference.ts`](../../../src/domain/ports/columnInference.ts): Rule-based and LLM column-inference contracts.
- [`src/domain/ports/services.ts`](../../../src/domain/ports/services.ts): Provider-neutral `SpreadsheetPort`, `Row`, and `CellValue` contracts; `readRows()` exists but is not implemented by either provider.
- [`src/domain/ports/categoryReader.ts`](../../../src/domain/ports/categoryReader.ts): Existing flat category-reader contract that must remain available for category-only spreadsheets.
- [`src/infrastructure/db/schema/index.ts`](../../../src/infrastructure/db/schema/index.ts): `column_mappings.gastto_field` check constraint that must admit `subcategoria` through a generated migration.
- [`src/infrastructure/adapters/sheets/columnHeaderVocabulary.ts`](../../../src/infrastructure/adapters/sheets/columnHeaderVocabulary.ts): Shared multilingual header vocabulary used by header detection and rule-based mapping inference.
- [`src/infrastructure/adapters/sheets/RuleBasedColumnInferenceAdapter.ts`](../../../src/infrastructure/adapters/sheets/RuleBasedColumnInferenceAdapter.ts): Exact, synonym, fuzzy, and content-assisted mapping inference.
- [`src/infrastructure/adapters/sheets/LLMColumnInferenceAdapter.ts`](../../../src/infrastructure/adapters/sheets/LLMColumnInferenceAdapter.ts): Structured LLM mapping schema, prompt, validation, and safe fallback.
- [`src/application/use-cases/spreadsheet/InferColumnMapping.ts`](../../../src/application/use-cases/spreadsheet/InferColumnMapping.ts): Hybrid inference, required-field completeness decisions, mapping persistence, and proposal payload.
- [`src/application/use-cases/spreadsheet/CorrectColumnMapping.ts`](../../../src/application/use-cases/spreadsheet/CorrectColumnMapping.ts): Manual mapping correction and validated `unmappedFields` restoration.
- [`src/application/services/ColumnMappingCorrectionParser.ts`](../../../src/application/services/ColumnMappingCorrectionParser.ts): Deterministic natural-language field-to-column correction parser.
- [`src/application/copies/onboarding.copies.ts`](../../../src/application/copies/onboarding.copies.ts): Mapping proposal, correction, rejection, and unmapped-field copies.
- [`src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts`](../../../src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts): Google Sheets implementation whose `readRows()` currently returns `STRUCTURE_ERROR` without making a provider request.
- [`src/infrastructure/adapters/sheets/ExcelOnlineAdapter.ts`](../../../src/infrastructure/adapters/sheets/ExcelOnlineAdapter.ts): Excel Online implementation whose `readRows()` currently rejects without making a provider request.
- [`src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.ts`](../../../src/infrastructure/adapters/sheets/SpreadsheetCategoryReader.ts): Existing single-column reader and normalization behavior that the category-only path must retain.
- [`src/application/use-cases/spreadsheet/DetectCategories.ts`](../../../src/application/use-cases/spreadsheet/DetectCategories.ts): Current onboarding consumer; it remains unchanged in this subplan and will consume hierarchy detection in the next master phase.
- [`docs/adr/ADR-004-spreadsheet-adapter.md`](../../../docs/adr/ADR-004-spreadsheet-adapter.md): Provider adapter boundary and unified row-reading contract.
- [`docs/adr/ADR-022-linked-subcategory-hierarchy.md`](../../../docs/adr/ADR-022-linked-subcategory-hierarchy.md): Required-parent and parent-scoped uniqueness decisions.
- [`docs/features/infer-and-propose-column-mapping.md`](../../../docs/features/infer-and-propose-column-mapping.md): Canonical mapping inference behavior and contracts.
- [`docs/features/confirm-or-correct-column-mapping.md`](../../../docs/features/confirm-or-correct-column-mapping.md): Canonical manual mapping correction behavior and contracts.
- [`docs/architecture/data-model.md`](../../../docs/architecture/data-model.md): Canonical `column_mappings` constraint and generated-migration documentation.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): Adapter isolation, typed errors, negative assertions, and full-suite expectations.
- [`HU-4.08 - Configure linked categories and subcategories`](../../../docs/user-stories/02-release-2-producto-complejo/02-epica-4/HU-4.08%20%E2%80%94%20Configure%20linked%20categories%20and%20subcategories.md): Optional mapping, row-pair preservation, duplicate scope, orphan reporting, and category-only compatibility contract.

### Public contracts introduced or extended

- `GasttoField`: add `'subcategoria'` to the existing union without changing the meaning of the six current fields.
- Mapping completeness: preserve the current handling of `monto`, `moneda`, `categoria`, `fecha`, `concepto`, and `medio_pago`; treat `subcategoria` as optional, so its absence alone does not trigger LLM fallback, produce a no-header outcome, or block confirmation.
- `SpreadsheetPort.readRows(fileId, range)`: retain the existing signature and return real 1-based sheet row indexes plus provider values normalized to the existing `CellValue` union for both Google Sheets and Excel Online.
- `CategorySubcategoryPair`: `{ category: string; subcategory: string }`, with both values trimmed and lowercased consistently with the current flat category reader.
- `CategoryHierarchyReadResult`: `{ categories: string[]; pairs: CategorySubcategoryPair[]; orphanSubcategories: string[] }`.
- `ICategoryHierarchyReaderPort.readHierarchy(fileId, categoryColumnIndex, subcategoryColumnIndex, sheetName, dataStartRow?)`: read complete rows and return normalized categories, valid parent/child pairs, and excluded orphan child values.
- `ICategoryHierarchyReaderPortFactory.create(accessToken)`: produce a hierarchy reader backed by the provider-specific `SpreadsheetPort` without leaking provider SDK or HTTP types into Application or Domain.

## Phases

### Phase 1: Extend optional column mapping end to end

#### Description

Make `subcategoria` a valid persisted and user-correctable mapping while preserving the completeness and confirmation behavior of existing six-field spreadsheets. Deliver the additive schema migration, inference and copy updates, focused mapping tests, and synchronized canonical documentation together.

#### To-do actions

- [x] Add `'subcategoria'` to `GasttoField` and centralize the supported and legacy field collections so inference, merging, payload validation, and copies cannot drift; preserve the current handling of the six existing fields and keep `subcategoria` optional.
- [x] Extend `COLUMN_HEADER_DICTIONARY` with accent-normalized Spanish, English, and Portuguese subcategory synonyms while preserving the existing normalization and distinct category matches.
- [x] Extend `RuleBasedColumnInferenceAdapter` so exact, synonym, and fuzzy subcategory headers can produce a mapping; treat subcategory contents as text and do not infer a parent relationship from sample values.
- [x] Extend the LLM mapping prompt, `GasttoFieldSchema`, response validation, fallback result, and tests with `subcategoria`; keep spreadsheet headers and samples inside the existing untrusted-data boundary and reject invalid field names or column claims.
- [x] Update `InferColumnMapping` merging and fallback decisions so a mapped subcategory is retained and displayed, but an absent subcategory alone does not invoke the LLM, cause `noHeaderFound`, downgrade a valid category-only proposal, or block its confirmation.
- [x] Add subcategory field synonyms to `RuleBasedColumnMappingCorrectionParser`, accept `subcategoria` in `CorrectColumnMapping.resolveUnmappedFields`, and preserve the one-field-per-message and no-partial-correction rules when category and subcategory are mentioned together.
- [x] Extend mapping proposal, correction, rejection, and unmapped-field copies with a distinct subcategory label and icon; show a detected or manually assigned subcategory mapping, and describe an absent subcategory as optional rather than as a required field failure.
- [x] Add `subcategoria` to the Drizzle `column_mappings.gastto_field` check definition, run `pnpm db:generate`, and retain only the newly generated migration, snapshot, and journal changes; inspect the SQL to ensure it changes only the check constraint and does not edit or reorder an existing migration.
- [x] Extend the column-mapping PostgreSQL integration coverage to prove the generated migration accepts `subcategoria`, still rejects unknown field names, and preserves existing category-only mappings.
- [x] Extend focused tests for `RuleBasedColumnInferenceAdapter`, `LLMColumnInferenceAdapter`, `InferColumnMapping`, `ColumnMappingCorrectionParser`, `CorrectColumnMapping`, onboarding copies, and `DrizzleColumnMappingRepository`, covering mapped and unmapped optional subcategory columns, multilingual/fuzzy headers, manual assignment, duplicate-column protection, invalid LLM output, and category/subcategory multi-field rejection.
- [x] Update `docs/features/infer-and-propose-column-mapping.md` and `docs/features/confirm-or-correct-column-mapping.md` with the optional field, compatibility semantics, prompts, payload behavior, data constraint, and QA cases; update their descriptions in `docs/features/README.md` in the same change.
- [x] Update `docs/architecture/data-model.md` so the documented `column_mappings.gastto_field` constraint includes `subcategoria` and references the generated additive migration.
- [x] Run the focused mapping, correction, repository, and migration integration tests.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Implement provider row-reading contracts

#### Description

Implement the existing `SpreadsheetPort.readRows()` operation for Google Sheets and Excel Online so a later reader can preserve parent/child relationships by row. Keep provider-specific request construction, response validation, and error classification behind the adapters.

#### To-do actions

- [x] Document and enforce a provider-neutral A1 `range` input that includes the worksheet name and a 1-based starting row; reject malformed or non-positive ranges with `SpreadsheetError` using `STRUCTURE_ERROR` before issuing a provider request.
- [x] Implement `GoogleSheetsAdapter.readRows()` with the Sheets values endpoint, correct encoding for worksheet names and A1 ranges, bearer authentication, and the adapter's existing `AUTH_ERROR`, retryable `NETWORK_ERROR`, `STRUCTURE_ERROR`, and `UNKNOWN` classifications.
- [x] Parse Google values defensively into `Row[]`, preserve valid `string`, `number`, `boolean`, and `null` cells, keep column offsets for blank cells, return an empty array for a valid empty range, and calculate each 1-based row index from the requested or provider-returned range instead of resetting it to row 1.
- [x] Implement `ExcelOnlineAdapter.readRows()` with the Microsoft Graph worksheet range endpoint, safely split and encode the worksheet name and address, attach bearer authentication, and map authorization, provider/network, malformed-response, and invalid-range failures to the same typed spreadsheet error taxonomy used by the Google adapter.
- [x] Parse Excel values into the same `Row[]` contract, preserving cell types, blank-column offsets, empty ranges, and actual 1-based row indexes so consumers are provider-agnostic.
- [x] Extend `GoogleSheetsAdapter.spec.ts` and `ExcelOnlineAdapter.spec.ts` with mocked-HTTP contract tests for a non-first start row, mixed and blank cell values, sparse/trailing cells, empty results, worksheet names requiring encoding, malformed payloads, invalid ranges, authorization failures, provider 5xx responses, and transport failures.
- [x] Assert that neither adapter performs a request for a locally invalid range and that all tests continue to avoid real external APIs.
- [x] Run the focused Google Sheets and Excel Online adapter test suites.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Add row-preserving hierarchy pair detection

#### Description

Introduce a hierarchy reader and factory that consume complete rows from `SpreadsheetPort.readRows()`. Produce deterministic normalized parents, valid pairs, and separately reported orphans without wiring the result into `DetectCategories` or changing onboarding behavior yet.

#### To-do actions

- [x] Add the `CategorySubcategoryPair`, `CategoryHierarchyReadResult`, `ICategoryHierarchyReaderPort`, and `ICategoryHierarchyReaderPortFactory` domain contracts defined above while retaining `ICategoryReaderPort` unchanged for the existing flat flow.
- [x] Add `SpreadsheetCategoryHierarchyReader` in the spreadsheet adapter layer and build an A1 range from column A through the furthest mapped category/subcategory column, beginning at `dataStartRow` so returned value positions remain aligned with the absolute mapping indexes.
- [x] Validate non-negative mapped column indexes and a positive integer `dataStartRow`; propagate typed provider errors and never return a partially invented hierarchy after a read failure.
- [x] For each row, trim and lowercase category and subcategory text consistently with `SpreadsheetCategoryReader`; ignore rows where both values are blank and include category-only rows in `categories` without creating a child.
- [x] Deduplicate categories by normalized category, deduplicate pairs by normalized parent plus normalized child while preserving first-seen order, and keep an equal normalized child under different parents as two distinct pairs.
- [x] When a row has a nonblank subcategory and a blank category, exclude it from `pairs`, add its normalized value once to `orphanSubcategories`, and never assign a default, previous, or inferred parent.
- [x] Add the provider-aware factory wiring needed for future Application use while leaving `DetectCategories`, vocabulary persistence, FSM payloads, onboarding messages, and expense saving unchanged in this subplan.
- [x] Add `SpreadsheetCategoryHierarchyReader.spec.ts` with meaningful assertions for mapped category/subcategory columns in either order, custom data-start rows, duplicate normalized pairs, blank children, category-only rows, same-name children under different parents, duplicate orphans, fully blank rows, invalid indexes, empty results, and provider failure propagation.
- [x] Add factory tests proving both `google` and `microsoft` readers use their existing `readRows()` implementations without importing provider details into Domain or Application code.
- [x] Run the focused hierarchy-reader and both provider adapter test suites.
- [x] Run `pnpm test` to execute the complete project test suite after the focused tests pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete; review and commit the finished subcategory spreadsheet mapping and hierarchy detection subplan.
