# Infer and Propose Column Mapping

## Overview

The Infer and Propose Column Mapping feature analyzes the headers and first rows of the user's selected spreadsheet and suggests which column corresponds to each Gastto field (date, amount, currency, category, description, payment method). It runs automatically after successful spreadsheet access validation (HU-4.04) and presents the proposal to the user while the conversation is in the `ONBOARDING_MAPPING` state. The goal is to remove manual configuration from onboarding and make the first expense recording as smooth as possible.

This feature is part of the spreadsheet-linking epic covered by [`HU-4.05 — Infer and propose column mapping`](../user-stories/01-mvp/01-Vinculación%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.05-infer-and-propose-column-mapping/HU-4.05%20%E2%80%94%20Infer%20and%20propose%20column%20mapping.md).

## Scope

- **In scope:**
  - Header normalization (lowercase, trim, NFD unaccent, collapse whitespace).
  - Header-row detection across the first 20 rows, with rule-based scanning and LLM fallback.
  - Rule-based column inference using multi-language synonym dictionaries (ES/EN/PT).
  - LLM-powered column inference fallback when rule-based inference has low confidence or unmapped fields.
  - Hybrid merging that keeps high-confidence rule-based mappings and fills gaps with LLM proposals.
  - High-confidence (`alta`) proposals for exact and synonym matches.
  - Low-confidence (`baja`) proposals for fuzzy matches (Levenshtein ratio ≥ 0.75).
  - No-header detection when row 1 values look like data (numeric/date/currency).
  - Content-type validation on sample rows to boost or reduce confidence.
  - Reporting of unmapped Gastto fields.
  - Persistence of inferred mappings in `column_mappings`.
  - User-facing proposal messages with emoji indicators and uncertainty hints.
  - Error handling for token problems, missing config, and missing preview.

- **Out of scope:**
  - Mapping confirmation or correction by the user (HU-4.06).
  - Persisting `confirmed_at` timestamps (HU-4.06).
  - Category vocabulary setup (HU-4.07).
  - OneDrive column mapping (MVP returns "coming soon" for `microsoft` provider).

## FSM States

| State              | Description                                          | Next                                                               |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `ONBOARDING_MAPPING` | User is reviewing the proposed column mapping       | `ONBOARDING_CATEGORIES` (mapping accepted), self-transition (re-prompt / no-header) |

## Flow Sequence

### Scenario 1: Clear headers - high-confidence mapping

1. The user enters `ONBOARDING_MAPPING` after `ValidateSpreadsheetAccess` succeeds.
2. The message worker delegates to `InferColumnMapping.execute()` with the conversation state payload.
3. `InferColumnMapping` retrieves and decrypts the OAuth token, loads the `SpreadsheetConfig`, and extracts the `SpreadsheetPreview` from the state payload.
4. `HeaderDetectionPort` scans the preview rows and returns the 1-based row index that contains the headers; if uncertain, `LLMHeaderDetectionAdapter` is used as fallback.
5. Headers and sample rows below the detected header row are passed to `ColumnInferencePort.infer()`.
6. `RuleBasedColumnInferenceAdapter` normalizes each header and matches it against the synonym dictionary.
7. Exact or synonym matches produce mappings with `confidence: 'alta'`.
8. Content-type validation on sample rows confirms the expected type (date, number, currency) and keeps confidence high.
9. Because all mapped fields have `confidence: 'alta'` and there are no unmapped fields, the LLM inference fallback is skipped.
10. Mappings are persisted via `IColumnMappingRepository.upsertMany()` with `inferred: true` and `confirmedAt: null`.
11. A proposal message is built with emoji indicators (📅💰🏷️📝💳💱) and column letters, ending with "Is this correct?".
12. The message is sent via `MessagingOutputPort` and the FSM self-transitions to `ONBOARDING_MAPPING` with `mappings` and `unmappedFields` in the payload.

### Scenario 2: Ambiguous headers - low-confidence mapping

1. Steps 1-4 from Scenario 1 are executed.
2. Some headers do not match any synonym exactly but are close enough (Levenshtein ratio ≥ 0.75), producing mappings with `confidence: 'baja'`.
3. Content-type validation may boost confidence to `alta` if sample rows confirm the expected type, or leave it as `baja` if they do not.
4. Mappings are persisted as in Scenario 1.
5. A proposal message is built with an uncertainty indicator ("I'm not sure about some fields, this is my best attempt").
6. The message is sent and the FSM self-transitions to `ONBOARDING_MAPPING`.

### Scenario 3: LLM fallback for ambiguous or non-dictionary headers

1. Steps 1-6 from Scenario 1 are executed.
2. `RuleBasedColumnInferenceAdapter` returns some mappings with `confidence: 'baja'` or leaves one or more Gastto fields in `unmappedFields`.
3. `InferColumnMapping` invokes `LLMColumnInferenceAdapter` with the detected headers and sample rows.
4. The LLM returns a JSON mapping for the columns it can identify.
5. `InferColumnMapping` merges the rule-based and LLM results: high-confidence rule-based mappings are kept, low-confidence or missing fields are filled from the LLM proposal.
6. The merged mappings are persisted and a proposal message is sent, using low-confidence copy if any mapping remains `baja`.
7. The FSM self-transitions to `ONBOARDING_MAPPING` with the merged `mappings` and `unmappedFields`.

### Scenario 4: No headers detected

1. Steps 1-6 from Scenario 1 are executed.
2. `RuleBasedColumnInferenceAdapter` detects that every value in the header row looks like data (numeric, date, or currency) rather than labels.
3. `InferColumnMapping` invokes `LLMColumnInferenceAdapter` as a fallback.
4. If the LLM also cannot identify headers or returns no mappings, no mappings are persisted.
5. `InferColumnMapping` sends `onboardingCopies.noHeaderPrompt()`, asking the user which row the data starts at.
6. The FSM self-transitions to `ONBOARDING_MAPPING` with `step: 'no-header'` in the payload.
7. When the user replies with a row number, the message worker subtracts 1 to obtain the header row index and validates that the computed header row exists in the preview.
8. If the reply is invalid or the computed header row is not present, the worker sends `onboardingCopies.invalidDataStartRowPrompt()` and keeps the FSM in `ONBOARDING_MAPPING` with `step: 'no-header'`.
9. If valid, the worker delegates to `InferColumnMapping` with `headerRowIndex` in the state payload, which skips automatic detection and uses that row as the header row.
10. `InferColumnMapping` proceeds with header/sample extraction and inference as in Scenario 1.

### Scenario 5: Unmapped fields

1. Steps 1-6 from Scenario 1 are executed.
2. Some Gastto fields have no matching column (exact, synonym, fuzzy, or LLM).
3. The final result returns those fields in `unmappedFields`.
4. The matched mappings are persisted.
5. The proposal message lists the unmapped fields and notes that they will be omitted during expense recording unless the user assigns a column manually.
6. The message is sent and the FSM self-transitions to `ONBOARDING_MAPPING`.

### Scenario 6: Multi-language headers

1. Steps 1-6 from Scenario 1 are executed.
2. Headers are in English (e.g., "Date", "Amount", "Category") or Portuguese (e.g., "Data", "Valor", "Categoria").
3. The synonym dictionary maps them to the corresponding Gastto fields with `confidence: 'alta'`.
4. Because all mapped fields are high-confidence and there are no unmapped fields, the LLM fallback is skipped.
5. Mappings are persisted and a high-confidence proposal message is sent, identical to Scenario 1.

## Adapters

- **RuleBasedHeaderDetectionAdapter** - Implements `HeaderDetectionPort` by scanning preview rows and returning the first row whose values look like labels rather than data.
- **LLMHeaderDetectionAdapter** - Implements `HeaderDetectionPort` by asking an LLM to locate the header row when rule-based detection is uncertain.
- **RuleBasedColumnInferenceAdapter** - Implements `ColumnInferencePort` using header normalization, multi-language synonym dictionaries, Levenshtein fuzzy matching, and content-type heuristics.
- **LLMColumnInferenceAdapter** - Implements `ColumnInferencePort` by asking an LLM to map headers to Gastto fields when rule-based inference is incomplete or low-confidence.
- **DrizzleColumnMappingRepository** - Implements `IColumnMappingRepository` using Drizzle ORM to persist and update `column_mappings` records.

## API Contracts

### Application DTOs

#### `InferColumnMappingInput`

```ts
interface InferColumnMappingInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}
```

#### `InferColumnMappingOutput`

```ts
interface InferColumnMappingOutput {
  nextState: FsmState;
  message: string;
  payload?: Record<string, unknown>;
}
```

#### `InferColumnMappingDeps`

```ts
interface InferColumnMappingDeps {
  tokenRepository: IOAuthTokenRepository;
  tokenEncryption: TokenEncryptionPort;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  columnMappingRepository: IColumnMappingRepository;
  columnInferencePort: ColumnInferencePort;
  llmColumnInferencePort: ColumnInferencePort;
  headerDetectionPort: HeaderDetectionPort;
  llmHeaderDetectionPort: HeaderDetectionPort;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
}
```

### Domain Ports

#### `HeaderDetectionPort`

```ts
interface HeaderDetectionPort {
  detectHeaderRow(rows: Row[]): Promise<number | null>;
}
```

Returns the 1-based sheet row index that contains the headers, or `null` when no row can be confidently identified.

#### `ColumnInferencePort`

```ts
interface ColumnInferencePort {
  infer(headers: string[], sampleRows: string[][]): Promise<ColumnInferenceResult>;
}
```

#### `ColumnInferenceResult`

```ts
interface ColumnInferenceResult {
  mappings: ColumnInferenceMapping[];
  noHeaderFound: boolean;
  unmappedFields: GasttoField[];
}
```

#### `ColumnInferenceMapping`

```ts
interface ColumnInferenceMapping {
  gasttoField: GasttoField;
  columnIndex: number;
  columnHeader: string;
  confidence: 'alta' | 'baja';
}
```

### Repository Port

#### `IColumnMappingRepository`

```ts
interface IColumnMappingRepository {
  findBySpreadsheetId(spreadsheetId: string): Promise<ColumnMapping[]>;
  upsertMany(mappings: Omit<ColumnMapping, 'id'>[]): Promise<void>;
  confirm(id: string): Promise<void>;
}
```

## Data Model

- `column_mappings` table (see [`docs/architecture/data-model.md`](docs/architecture/data-model.md))
  - `spreadsheet_id` (FK → `spreadsheet_configs.id`, CASCADE)
  - `gastto_field` (TEXT, CHECK: `monto`, `moneda`, `categoria`, `fecha`, `concepto`, `medio_pago`)
  - `column_index` (SMALLINT)
  - `column_header` (TEXT)
  - `inferred` (BOOLEAN, default `true`)
  - `confirmed_at` (TIMESTAMPTZ, NULL = pending confirmation)
  - UNIQUE: `(spreadsheet_id, gastto_field)`
  - UNIQUE: `(spreadsheet_id, column_index)`

## Error Handling

| Scenario                                      | Behavior                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| Missing OAuth token                           | `reconnectAccount` message sent; transitions to `ONBOARDING_START`.      |
| Expired / revoked token                       | `reconnectAccount` message sent; transitions to `ONBOARDING_START`.      |
| Token decryption failure                      | `reconnectAccount` message sent; transitions to `ONBOARDING_START`.      |
| Missing `SpreadsheetConfig`                   | `reconnectAccount` message sent; transitions to `ONBOARDING_START`.      |
| Missing or empty preview in state payload     | `reconnectAccount` message sent; transitions to `ONBOARDING_START`.      |
| Microsoft (`onedrive`) provider               | `comingSoon('OneDrive')` message sent; stays in `ONBOARDING_MAPPING`.    |
| Inference adapter failure                     | Error propagated; no mappings persisted; no state transition is written. |
| `columnMappingRepository.upsertMany` failure  | Error propagated; no message sent; state payload is not updated.         |

## QA Checklist

### RuleBasedColumnInferenceAdapter

- [x] Exact header match returns `confidence: 'alta'` for all 6 `GasttoField` values.
- [x] Synonym match (e.g., "Fecha" → `fecha`, "Date" → `fecha`, "Data" → `fecha`) returns `confidence: 'alta'`.
- [x] Fuzzy match (e.g., "Fcha" → `fecha` with Levenshtein ratio ≥ 0.75) returns `confidence: 'baja'`.
- [x] No-header detection: when row 1 values are all numeric/date/currency, `noHeaderFound` is `true`.
- [x] Multi-language: ES ("Fecha", "Monto", "Categoría"), EN ("Date", "Amount", "Category"), PT ("Data", "Valor", "Categoria") all resolve correctly.
- [x] Unmapped fields are reported in `unmappedFields` when no column matches.
- [x] Content-type validation: a column with date-like values in sample rows increases date mapping confidence.
- [x] No imports from Application or Interfaces layers.

### DrizzleColumnMappingRepository

- [x] `findBySpreadsheetId` returns mapped `ColumnMapping[]` with correct field types.
- [x] `upsertMany` inserts new mappings in a single query.
- [x] `upsertMany` updates existing mappings on conflict.
- [x] `confirm(id)` sets `confirmedAt` to current timestamp.
- [x] `confirm(id)` throws when mapping does not exist.

### ConversationState FSM

- [x] `canTransition('ONBOARDING_MAPPING', 'ONBOARDING_MAPPING')` returns `true`.
- [x] `canTransition('ONBOARDING_MAPPING', 'ONBOARDING_CATEGORIES')` returns `true`.
- [x] Invalid transitions from `ONBOARDING_MAPPING` are rejected.

### InferColumnMapping use case

- [x] High-confidence mapping: message includes emoji indicators, mappings persisted with `inferred: true` and `confirmedAt: null`.
- [x] Low-confidence mapping: message includes uncertainty indicator and triggers LLM fallback.
- [x] LLM fallback merges results while preserving high-confidence rule-based mappings.
- [x] Header-row detection works for headers beyond row 1.
- [x] LLM header detection fallback runs when rule-based detection is uncertain.
- [x] No-header detection: self-transition to `ONBOARDING_MAPPING` with `step: 'no-header'`, message asks which row data starts at.
- [x] No-header reply: valid row number is converted to `headerRowIndex` and inference re-runs; invalid reply re-prompts with `invalidDataStartRowPrompt`.
- [x] Header row index override: `headerRowIndex` in state payload skips detection and uses the specified row.
- [x] Unmapped fields: message lists omitted fields.
- [x] Multi-language headers: ES/EN/PT headers recognized and mapped correctly.
- [x] Missing token: sends reconnect message and transitions to `ONBOARDING_START`.
- [x] Expired token: sends reconnect message and transitions to `ONBOARDING_START`.
- [x] Revoked token: sends reconnect message and transitions to `ONBOARDING_START`.
- [x] Decryption failure: sends reconnect message and transitions to `ONBOARDING_START`.
- [x] Missing spreadsheet config: sends reconnect message and transitions to `ONBOARDING_START`.
- [x] Missing preview in payload: sends reconnect message and transitions to `ONBOARDING_START`.
- [x] Microsoft provider: sends coming soon message and stays in `ONBOARDING_MAPPING`.
- [x] No imports from Infrastructure or Interfaces layers.

### Message worker

- [x] `ONBOARDING_MAPPING` delegates to `InferColumnMapping` when wired.
- [x] `ONBOARDING_MAPPING` falls back to placeholder when `InferColumnMapping` is not wired.

## Related User Stories

- [`HU-4.05 — Infer and propose column mapping`](../user-stories/01-mvp/01-Vinculación%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.05-infer-and-propose-column-mapping/HU-4.05%20%E2%80%94%20Infer%20and%20propose%20column%20mapping.md)

## Notes

- Rule-based inference runs first to keep latency and cost low for common headers.
- LLM inference is used as a fallback for ambiguous, non-dictionary, or partially-mapped spreadsheets.
- Levenshtein distance is implemented inline (~30 lines) to avoid adding a dependency.
- The domain entity uses `GasttoField` (capital G) while the DB column uses `gastto_field` (lowercase). The repository handles the mapping.
- Content-type validation uses regex patterns for dates (`\d{1,2}/\d{1,2}/\d{2,4}`), numbers (`^\d+([.,]\d+)?$`), and currency codes (ARS, EUR, USD, MXN, GBP, BRL).
- The confidence threshold for fuzzy match is Levenshtein ratio ≥ 0.75.
- Future work (HU-4.06): allow the user to confirm or correct the mapping field by field and persist `confirmed_at`.
