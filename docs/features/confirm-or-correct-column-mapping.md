# Confirm or Correct Column Mapping

## Overview

The Confirm or Correct Column Mapping feature lets the user review the column mapping proposed by Gastto and either accept it with a single confirmation or correct it field by field using natural language. Corrections are accumulated in a transient Redis-backed state with a 30-minute TTL, so the user can resume an abandoned correction session. Once the mapping is accepted, the FSM advances to `ONBOARDING_CATEGORIES`.

This feature is part of the spreadsheet-linking epic covered by [`HU-4.06 — Confirm or correct column mapping`](../user-stories/01-mvp/01-Vinculación%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.06-confirm-or-correct-column-mapping/HU-4.06%20%E2%80%94%20Confirm%20or%20correct%20column%20mapping.md).

## Scope

- **In scope:**
  - Single confirmation ("yes", "ok", "correct") that finalizes the mapping and advances to `ONBOARDING_CATEGORIES`.
  - Natural-language correction parsing for per-field mapping changes.
  - LLM re-inference when the user rejects the whole proposal without giving a specific correction (e.g., "no", "incorrecto", "wrong").
  - Column validation against the actual spreadsheet headers.
  - Accumulation of multiple corrections and re-display of the updated mapping after each one.
  - Redis-backed transient correction state with configurable TTL (default 30 minutes).
  - Resume behavior after abandonment via the persisted correction state.
  - Error handling for missing config, missing mappings, missing or expired tokens, invalid columns, unparseable messages, and missing preview during re-inference.

- **Out of scope:**
  - Initial mapping inference (HU-4.05).
  - Category vocabulary setup (HU-4.07).
  - Moving the main conversation FSM state out of PostgreSQL; only the transient correction state lives in Redis.

## FSM States

| State                  | Description                                                           | Next                                                                 |
| ---------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `ONBOARDING_MAPPING`   | User is reviewing or correcting the proposed column mapping           | `ONBOARDING_CATEGORIES` (confirmed), self-transition (correction)    |
| `ONBOARDING_START`     | User must reconnect the cloud storage account                         | -                                                                    |

## Flow Sequence

### Scenario 1: User confirms the full mapping

1. The conversation is in `ONBOARDING_MAPPING` with the proposed `mappings` in the state payload.
2. The message worker detects a confirmation intent and delegates to `ConfirmColumnMapping.execute()`.
3. The use case loads the `SpreadsheetConfig`, finds the proposed `ColumnMapping` records, and marks them as confirmed via `IColumnMappingRepository.confirmBySpreadsheetId()`.
4. A confirmation message is sent and the FSM transitions to `ONBOARDING_CATEGORIES`.

### Scenario 2: User corrects one field in natural language

1. The conversation is in `ONBOARDING_MAPPING` with the proposed `mappings` in the state payload.
2. The message worker detects a correction intent and delegates to `CorrectColumnMapping.execute()`.
3. The use case loads the `SpreadsheetConfig` and proposed mappings.
4. `ColumnMappingCorrectionParser.parse(rawMessage)` extracts the target `GasttoField` and a column reference.
5. The OAuth token is retrieved, decrypted, and `ISpreadsheetColumnPort.listAvailableColumns()` returns the available columns.
6. The column reference is resolved against letters, numbers, or header names.
7. If the column exists, the correction is applied through `ColumnMappingCorrectionState`, the updated snapshot is saved to Redis via `IMappingCorrectionStateRepository.save()`, and the updated mapping is sent back for re-confirmation.
8. The FSM self-transitions to `ONBOARDING_MAPPING` with the updated `mappings` payload.

### Scenario 3: User corrects several fields

1. The user corrects a first field as in Scenario 2.
2. The correction snapshot is loaded from Redis on the next correction.
3. Each new correction is accumulated; corrections for the same field replace the previous one.
4. After each correction the full updated mapping is displayed again for confirmation.

### Scenario 4: User indicates a column that does not exist

1. Steps 1-5 from Scenario 2 are executed.
2. The column reference cannot be resolved against the available columns.
3. No correction state is persisted.
4. The use case returns the list of available columns and a re-prompt message.
5. The FSM stays in `ONBOARDING_MAPPING` without updating the payload.

### Scenario 5: User abandons the correction flow

1. The user starts one or more corrections; each save refreshes the Redis TTL.
2. After 30 minutes of inactivity the Redis key expires automatically.
3. On resume, `IMappingCorrectionStateRepository.load()` returns `null`; the use case rebuilds the state from the proposed mappings and the flow continues from the original proposal.

### Scenario 6: User rejects the proposal without a specific correction

1. The conversation is in `ONBOARDING_MAPPING` with the proposed `mappings` and the original `preview` in the state payload.
2. The user sends a rejection message such as "no", "incorrecto", or "wrong".
3. The message worker delegates to `CorrectColumnMapping.execute()`.
4. `ColumnMappingCorrectionParser` cannot parse a specific field/column correction.
5. `CorrectColumnMapping` detects the rejection intent and invokes `LLMColumnInferenceAdapter` (with header-row detection fallback) on the preview.
6. The new LLM-proposed mappings replace the previous ones in `column_mappings`.
7. A new proposal message is sent and the FSM self-transitions to `ONBOARDING_MAPPING` with the updated `mappings` and `unmappedFields`.
8. If the LLM cannot locate headers or infer any mapping, `onboardingCopies.noHeaderPrompt()` is sent instead.

## Adapters

- **RuleBasedColumnMappingCorrectionParser** - Implements `ColumnMappingCorrectionParser` using deterministic regex/rules to extract `{ field, columnRef }` from Spanish/English messages.
- **CorrectColumnMapping** - Application use case that orchestrates parsing, column validation, state accumulation, messaging, and LLM re-inference on rejection.
- **ConfirmColumnMapping** - Application use case that finalizes the mapping when the user confirms it.
- **RedisMappingCorrectionStateRepository** - Implements `IMappingCorrectionStateRepository` using Redis `SETEX`/`GET`/`DEL` with the key `conversation:{userId}:mapping-correction`.
- **GoogleSheetsAdapter** - Implements `ISpreadsheetColumnPort.listAvailableColumns()` for Google Sheets.
- **LLMHeaderDetectionAdapter** / **RuleBasedHeaderDetectionAdapter** - Provide header-row detection for rejection re-inference.
- **LLMColumnInferenceAdapter** - Provides LLM-powered column mapping during rejection re-inference.

## API Contracts

### Application DTOs

#### `CorrectColumnMappingInput`

```ts
interface CorrectColumnMappingInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  rawMessage: string;
  statePayload: Record<string, unknown> | null;
}
```

#### `CorrectColumnMappingOutput`

```ts
type CorrectColumnMappingOutput =
  | { kind: 'updated'; nextState: FsmState; message: string }
  | { kind: 'invalid-column'; nextState: FsmState; message: string; availableColumns: AvailableColumn[] }
  | { kind: 'parse-failure'; nextState: FsmState; message: string }
  | { kind: 'no-proposed-mapping'; nextState: FsmState; message: string }
  | { kind: 're-inferred'; nextState: FsmState; message: string; payload?: Record<string, unknown> };
```

#### `CorrectColumnMappingDeps`

```ts
interface CorrectColumnMappingDeps {
  columnMappingRepository: IColumnMappingRepository;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  tokenRepository: IOAuthTokenRepository;
  tokenEncryption: TokenEncryptionPort;
  spreadsheetColumnPort: ISpreadsheetColumnPort;
  correctionParser: ColumnMappingCorrectionParser;
  correctionStateRepository: IMappingCorrectionStateRepository;
  headerDetectionPort: HeaderDetectionPort;
  llmHeaderDetectionPort: HeaderDetectionPort;
  llmColumnInferencePort: ColumnInferencePort;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
  stateTtlSeconds: number;
}
```

#### `ConfirmColumnMappingInput`

```ts
interface ConfirmColumnMappingInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}
```

#### `ConfirmColumnMappingOutput`

```ts
interface ConfirmColumnMappingOutput {
  nextState: FsmState;
  message: string;
  payload?: Record<string, unknown>;
}
```

### Domain Port

#### `ColumnMappingCorrectionParser`

```ts
interface ColumnMappingCorrectionParser {
  parse(message: string): CorrectionParseResult;
}
```

```ts
type CorrectionParseResult =
  | { kind: 'success'; field: GasttoField; columnRef: string }
  | { kind: 'failure'; reason: string };
```

#### `ISpreadsheetColumnPort`

```ts
interface ISpreadsheetColumnPort {
  listAvailableColumns(input: ListAvailableColumnsInput): Promise<AvailableColumn[]>;
}
```

```ts
interface AvailableColumn {
  index: number;
  columnHeader: string;
}
```

### Repository Port

#### `IMappingCorrectionStateRepository`

```ts
interface IMappingCorrectionStateRepository {
  save(userId: string, state: MappingCorrectionStateSnapshot, ttlSeconds: number): Promise<void>;
  load(userId: string): Promise<MappingCorrectionStateSnapshot | null>;
  clear(userId: string): Promise<void>;
}
```

```ts
interface MappingCorrectionStateSnapshot {
  originalMapping: ColumnMapping[];
  corrections: MappingCorrection[];
  status: MappingCorrectionStatus;
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

- Redis key: `conversation:{userId}:mapping-correction`
  - Value: JSON-serialized `MappingCorrectionStateSnapshot`.
  - TTL: `MAPPING_CORRECTION_TTL_SECONDS` (default 1800 seconds / 30 minutes).

## Error Handling

| Scenario                                | Behavior                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Missing OAuth token                     | `reconnectAccount` message sent; transitions to `ONBOARDING_START`.      |
| Expired / revoked token                 | `reconnectAccount` message sent; transitions to `ONBOARDING_START`.      |
| Token decryption failure                | `reconnectAccount` message sent; transitions to `ONBOARDING_START`.      |
| Missing `SpreadsheetConfig`             | `reconnectAccount` message sent; transitions to `ONBOARDING_START`.      |
| No proposed mappings                    | `noMappingToConfirm` message sent; stays in `ONBOARDING_MAPPING`.        |
| Unparseable correction message          | `correctionParseFailurePrompt` sent; stays in `ONBOARDING_MAPPING`.      |
| Invalid column reference                | `invalidColumnPrompt` sent with available columns; stays in `ONBOARDING_MAPPING`. |
| Redis save failure                      | Error propagated; no confirmation message sent; no state transition.     |
| Transition failure after valid correction | Updated mapping message already sent; error propagated.                  |

## QA Checklist

### RuleBasedColumnMappingCorrectionParser

- [x] Recognizes Spanish field synonyms (`categoría`, `monto`, `fecha`, `concepto`, `moneda`, `medio de pago`).
- [x] Recognizes English field synonyms (`category`, `amount`, `date`, `description`, `currency`, `payment method`).
- [x] Extracts column references as letters (`E`), numbers (`5`), or header names (`"Descripción"`).
- [x] Returns explicit failure for confirmation messages like "sí" or unrelated text.

### CorrectColumnMapping use case

- [x] Valid single-field correction returns updated mapping and persists correction state.
- [x] Cumulative corrections for different fields are accumulated.
- [x] New correction for the same field replaces the previous correction.
- [x] Invalid column reference returns available columns without persisting state.
- [x] Parse failure leaves state unchanged and returns a helpful copy.
- [x] Rejection without specific correction triggers LLM re-inference and replaces the previous proposal.
- [x] Re-inference falls back to LLM header detection when rule-based detection is uncertain.
- [x] Missing spreadsheet config triggers reconnect flow.
- [x] Missing proposed mappings returns appropriate message without transition.
- [x] Missing or expired token triggers reconnect flow.
- [x] Token decryption failure triggers reconnect flow.
- [x] Redis save failure prevents confirmation message and state transition.

### ConfirmColumnMapping use case

- [x] Confirms all mappings and transitions to `ONBOARDING_CATEGORIES`.
- [x] Missing config triggers reconnect flow.
- [x] No mappings returns appropriate message.
- [x] Repository failure prevents confirmation message.

### RedisMappingCorrectionStateRepository

- [x] `save` serializes the snapshot and calls `SETEX` with the configured TTL.
- [x] `load` deserializes the snapshot and returns `null` when the key is missing.
- [x] `load` returns `null` for malformed JSON.
- [x] `clear` deletes the correction state key.

### Message worker

- [x] `ONBOARDING_MAPPING` routes confirmation intent to `ConfirmColumnMapping`.
- [x] `ONBOARDING_MAPPING` routes correction intent to `CorrectColumnMapping`.
- [x] `ONBOARDING_MAPPING` routes first entry (no `mappings` payload) to `InferColumnMapping`.

## Related User Stories

- [`HU-4.05 — Infer and propose column mapping`](../user-stories/01-mvp/01-Vinculación%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.05-infer-and-propose-column-mapping/HU-4.05%20%E2%80%94%20Infer%20and%20propose%20column%20mapping.md)
- [`HU-4.06 — Confirm or correct column mapping`](../user-stories/01-mvp/01-Vinculación%20de%20planilla%20%C2%B7%20Release%201%20MVP/HU-4.06-confirm-or-correct-column-mapping/HU-4.06%20%E2%80%94%20Confirm%20or%20correct%20column%20mapping.md)

## Notes

- The transient correction state intentionally lives in Redis while the conversation FSM remains in PostgreSQL, following ADR-003.
- `ColumnMappingCorrectionState` is immutable; each correction returns a new value object.
- The parser is deterministic and dependency-free so it can be replaced by an LLM-based adapter later without changing the use case.
- `MAPPING_CORRECTION_TTL_SECONDS` is configurable via environment variables; the default is 1800 seconds (30 minutes).
