# Infer and Propose Column Mapping

## Overview

The Infer and Propose Column Mapping feature analyzes the headers and first rows of the user's selected spreadsheet and suggests which column corresponds to each Gastto field (date, amount, currency, category, description, payment method). It runs automatically after successful spreadsheet access validation (HU-4.04) and presents the proposal to the user while the conversation is in the `ONBOARDING_MAPPING` state. The goal is to remove manual configuration from onboarding and make the first expense recording as smooth as possible.

This feature is part of the spreadsheet-linking epic covered by [`HU-4.05 — Infer and propose column mapping`](../user-stories/01-mvp/01-Vinculación%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.05-infer-and-propose-column-mapping/HU-4.05%20%E2%80%94%20Infer%20and%20propose%20column%20mapping.md).

## Scope

- **In scope:**
  - Header normalization (lowercase, trim, NFD unaccent, collapse whitespace).
  - Rule-based column inference using multi-language synonym dictionaries (ES/EN/PT).
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
4. Headers (row 1) and sample rows (rows 2-10) are passed to `ColumnInferencePort.infer()`.
5. `RuleBasedColumnInferenceAdapter` normalizes each header and matches it against the synonym dictionary.
6. Exact or synonym matches produce mappings with `confidence: 'alta'`.
7. Content-type validation on sample rows confirms the expected type (date, number, currency) and keeps confidence high.
8. Mappings are persisted via `IColumnMappingRepository.upsertMany()` with `inferred: true` and `confirmedAt: null`.
9. A proposal message is built with emoji indicators (📅💰🏷️📝💳💱) and column letters, ending with "Is this correct?".
10. The message is sent via `MessagingOutputPort` and the FSM self-transitions to `ONBOARDING_MAPPING` with `mappings` and `unmappedFields` in the payload.

### Scenario 2: Ambiguous headers - low-confidence mapping

1. Steps 1-4 from Scenario 1 are executed.
2. Some headers do not match any synonym exactly but are close enough (Levenshtein ratio ≥ 0.75), producing mappings with `confidence: 'baja'`.
3. Content-type validation may boost confidence to `alta` if sample rows confirm the expected type, or leave it as `baja` if they do not.
4. Mappings are persisted as in Scenario 1.
5. A proposal message is built with an uncertainty indicator ("I'm not sure about some fields, this is my best attempt").
6. The message is sent and the FSM self-transitions to `ONBOARDING_MAPPING`.

### Scenario 3: No headers detected

1. Steps 1-4 from Scenario 1 are executed.
2. `RuleBasedColumnInferenceAdapter` detects that every value in row 1 looks like data (numeric, date, or currency) rather than labels.
3. The adapter returns `noHeaderFound: true`, empty `mappings`, and all Gastto fields in `unmappedFields`.
4. No mappings are persisted.
5. `InferColumnMapping` sends `onboardingCopies.noHeaderPrompt()`, asking the user which row the data starts at.
6. The FSM self-transitions to `ONBOARDING_MAPPING` with `step: 'no-header'` in the payload.

### Scenario 4: Unmapped fields

1. Steps 1-4 from Scenario 1 are executed.
2. Some Gastto fields have no matching column (exact, synonym, or fuzzy).
3. The adapter returns those fields in `unmappedFields`.
4. The matched mappings are persisted.
5. The proposal message lists the unmapped fields and notes that they will be omitted during expense recording unless the user assigns a column manually.
6. The message is sent and the FSM self-transitions to `ONBOARDING_MAPPING`.

### Scenario 5: Multi-language headers

1. Steps 1-4 from Scenario 1 are executed.
2. Headers are in English (e.g., "Date", "Amount", "Category") or Portuguese (e.g., "Data", "Valor", "Categoria").
3. The synonym dictionary maps them to the corresponding Gastto fields with `confidence: 'alta'`.
4. Mappings are persisted and a high-confidence proposal message is sent, identical to Scenario 1.

## Adapters

- **RuleBasedColumnInferenceAdapter** - Implements `ColumnInferencePort` using header normalization, multi-language synonym dictionaries, Levenshtein fuzzy matching, and content-type heuristics.
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
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
}
```

### Domain Port

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
- [x] Low-confidence mapping: message includes uncertainty indicator.
- [x] No-header detection: self-transition to `ONBOARDING_MAPPING` with `step: 'no-header'`, message asks which row data starts at.
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

- The inference algorithm is rule-based (no LLM) for the MVP to keep latency and cost low.
- Levenshtein distance is implemented inline (~30 lines) to avoid adding a dependency.
- The domain entity uses `GasttoField` (capital G) while the DB column uses `gastto_field` (lowercase). The repository handles the mapping.
- Content-type validation uses regex patterns for dates (`\d{1,2}/\d{1,2}/\d{2,4}`), numbers (`^\d+([.,]\d+)?$`), and currency codes (ARS, EUR, USD, MXN, GBP, BRL).
- The confidence threshold for fuzzy match is Levenshtein ratio ≥ 0.75.
- Future work (HU-4.06): allow the user to confirm or correct the mapping field by field and persist `confirmed_at`.
