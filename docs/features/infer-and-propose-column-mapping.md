# Feature: Infer and Propose Column Mapping

## Purpose

Analyze the headers and data of the user's spreadsheet and suggest which column corresponds to each Gastto field (date, amount, category, description, payment method, currency), so that the user doesn't have to configure the mapping from scratch and the onboarding process is smooth.

## Behavior (Implemented)

- The system normalizes headers using lowercase, trim, NFD unaccent, and collapse whitespace.
- The system matches normalized headers against multi-language dictionaries (ES/EN/PT) mapping synonyms to `GasttoField` values.
- Exact and synonym matches return `confidence: 'alta'`.
- Fuzzy matches using Levenshtein distance (threshold ≥ 0.75) return `confidence: 'baja'`.
- The system detects no-header conditions when row 1 values are all numeric/date/currency.
- The system validates column content types by inspecting sample rows (date patterns, numeric patterns, currency codes) to boost or reduce confidence.
- Unmapped fields are reported in `unmappedFields` when no column matches.
- The system supports Spanish, English, and Portuguese headers.
- The FSM allows `ONBOARDING_MAPPING` self-transition for the no-header sub-step.
- Inferred mappings are persisted via `DrizzleColumnMappingRepository` with `upsertMany`.

## Behavior (TODO)

- Present the proposed mapping to the user in a conversational message (requires integration with messaging layer).
- Allow the user to confirm or correct the mapping field by field (requires FSM integration).
- Handle the no-header sub-flow where the system asks which row data starts at (requires FSM integration).
- Persist confirmed mappings with `confirmed_at` timestamp (requires user confirmation flow).

## API / Interface

- `ColumnInferencePort.infer(headers: string[], sampleRows: string[][]): Promise<ColumnInferenceResult>`
  - Returns mappings with confidence levels, no-header flag, and unmapped fields.
- `IColumnMappingRepository.findBySpreadsheetId(spreadsheetId: string): Promise<ColumnMapping[]>`
  - Returns all mappings for a spreadsheet.
- `IColumnMappingRepository.upsertMany(mappings: Omit<ColumnMapping, 'id'>[]): Promise<void>`
  - Batch inserts or updates mappings using `ON CONFLICT (spreadsheet_id, gastto_field) DO UPDATE`.
- `IColumnMappingRepository.confirm(id: string): Promise<void>`
  - Sets `confirmed_at` to current timestamp.

## Data Model

- `column_mappings` table (see `docs/architecture/data-model.md`)
  - `spreadsheet_id` (FK → `spreadsheet_configs.id`, CASCADE)
  - `gastto_field` (TEXT, CHECK: `monto`, `moneda`, `categoria`, `fecha`, `concepto`, `medio_pago`)
  - `column_index` (SMALLINT)
  - `column_header` (TEXT)
  - `inferred` (BOOLEAN, default `true`)
  - `confirmed_at` (TIMESTAMPTZ, NULL = pending confirmation)
  - UNIQUE: `(spreadsheet_id, gastto_field)`
  - UNIQUE: `(spreadsheet_id, column_index)`

## Tests

- [x] Exact header match returns `confidence: 'alta'` for all 6 `GasttoField` values.
- [x] Synonym match (e.g., "Fecha" → `fecha`, "Date" → `fecha`, "Data" → `fecha`) returns `confidence: 'alta'`.
- [x] Fuzzy match (e.g., "Fcha" → `fecha` with Levenshtein ratio ≥ 0.75) returns `confidence: 'baja'`.
- [x] No-header detection: when row 1 values are all numeric/date/currency, `noHeaderFound` is `true`.
- [x] Multi-language: ES ("Fecha", "Monto", "Categoría"), EN ("Date", "Amount", "Category"), PT ("Data", "Valor", "Categoria") all resolve correctly.
- [x] Unmapped fields are reported in `unmappedFields` when no column matches.
- [x] Content-type validation: a column with date-like values in sample rows increases date mapping confidence.
- [x] No imports from Application or Interfaces layers.
- [x] FSM self-transition: `canTransition('ONBOARDING_MAPPING', 'ONBOARDING_MAPPING')` returns `true`.
- [x] Repository: `findBySpreadsheetId` returns mapped `ColumnMapping[]` with correct field types.
- [x] Repository: `upsertMany` inserts new mappings in a single query.
- [x] Repository: `upsertMany` updates existing mappings on conflict.
- [x] Repository: `confirm(id)` sets `confirmedAt` to current timestamp.
- [x] Repository: `confirm(id)` throws when mapping does not exist.

## Related User Stories

- [`HU-4.05 — Infer and propose column mapping`](../user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.05-infer-and-propose-column-mapping/HU-4.05 — Infer and propose column mapping.md)

## Notes

- The inference algorithm is rule-based (no LLM) for the MVP to keep latency and cost low.
- Levenshtein distance is implemented inline (~30 lines) to avoid adding a dependency.
- The domain entity uses `GasttoField` (capital G) while the DB column uses `gastto_field` (lowercase). The repository handles the mapping.
- Content-type validation uses regex patterns for dates (`\d{1,2}/\d{1,2}/\d{2,4}`), numbers (`^\d+([.,]\d+)?$`), and currency codes (ARS, EUR, USD, MXN, GBP, BRL).
- The confidence threshold for fuzzy match is Levenshtein ratio ≥ 0.75.
