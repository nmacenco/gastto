# FSM States — Gastto

> **Why this document exists:** The FSM is the operational heart of the system. An agent that generates message-handling code without knowing the valid states and their transitions will produce incoherent logic. ADR-003 mentions the FSM but is not the right place to consult transitions during development.
> **Related:**
>
> - [ADR-003 · Estado Conversacional: FSM Persistida en PostgreSQL](../adr/adr.md#adr-003--estado-conversacional-fsm-persistida-en-postgresql)
> - [ADR-014 · FSM Eager Advance](../adr/ADR-014-fsm-eager-advance.md)

---

## State table

| State                          | Description                                    | Valid outgoing transitions                                                          | Timeout |
| ------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------- | ------- |
| `IDLE`                         | No active flow                                 | → `ONBOARDING_START` \| `EXPENSE_RECEIVING`                                         | —       |
| `ONBOARDING_START`             | First contact, no spreadsheet linked           | → `ONBOARDING_START` (set `promptShown`) \| `ONBOARDING_DRIVE`                      | 30 min  |
| `ONBOARDING_DRIVE`             | Waiting for OAuth connection                   | → `ONBOARDING_FILE`                                                                 | 30 min  |
| `ONBOARDING_FILE`              | Waiting for file selection                     | → `ONBOARDING_FILE` (store `fileList` / `step`) \| `ONBOARDING_SHEET`               | 30 min  |
| `ONBOARDING_SHEET`             | Waiting for sheet selection                    | → `ONBOARDING_SHEET` (store `sheetList` / `step`) \| `ONBOARDING_VALIDATING_ACCESS` | 30 min  |
| `ONBOARDING_VALIDATING_ACCESS` | Validating read/write access on selected sheet | → `ONBOARDING_MAPPING` \| `ONBOARDING_SHEET` \| `ONBOARDING_START`                  | 30 min  |
| `ONBOARDING_MAPPING`           | Waiting for column-mapping confirmation        | → `ONBOARDING_CATEGORIES`                                                           | 30 min  |
| `ONBOARDING_CATEGORIES`        | Waiting for category confirmation              | → `IDLE`                                                                            | 30 min  |
| `EXPENSE_RECEIVING`            | Message received, processing NLP               | → `EXPENSE_CLARIFYING` \| `EXPENSE_REVIEW` \| `IDLE`                                | —       |
| `EXPENSE_CLARIFYING`           | Waiting for user clarification                 | → `EXPENSE_REVIEW` \| `IDLE`                                                        | 10 min  |
| `EXPENSE_REVIEW`               | Summary sent, waiting for confirmation         | → `EXPENSE_SAVING` \| `EXPENSE_CORRECTING` \| `IDLE`                                | 10 min  |
| `EXPENSE_CORRECTING`           | Applying user correction                       | → `EXPENSE_REVIEW` \| `IDLE`                                                        | —       |
| `EXPENSE_SAVING`               | Writing to the spreadsheet                     | → `IDLE` \| `EXPENSE_SAVING_RETRY` \| `ONBOARDING_START`                           | —       |
| `EXPENSE_SAVING_RETRY`         | Waiting for a user decision after a retryable failed save | → `IDLE` \| `ONBOARDING_VALIDATING_ACCESS`                              | 10 min  |

---

## Eager advance

Deterministic forward transitions — those that do not require user input or confirmation — may auto-trigger the next use case immediately after the state is persisted. See [ADR-014 · FSM Eager Advance](../adr/ADR-014-fsm-eager-advance.md) for the full decision, rules, and list of applicable transitions.

Current and planned eager-advance transitions:

- `ONBOARDING_DRIVE` → `ONBOARDING_FILE`: OAuth callback triggers file discovery.
- `ONBOARDING_FILE` → `ONBOARDING_SHEET`: file selection triggers sheet discovery.
- `ONBOARDING_SHEET` → `ONBOARDING_VALIDATING_ACCESS`: sheet confirmation (single-sheet auto-confirm, number, or name match) triggers access validation.
- `ONBOARDING_VALIDATING_ACCESS` → `ONBOARDING_MAPPING`: successful access validation triggers column-mapping inference.
- `EXPENSE_REVIEW` → `EXPENSE_SAVING`: user confirmation triggers save.
- `EXPENSE_SAVING` → `IDLE`: a confirmed save persists the record and triggers final confirmation.
- `EXPENSE_REVIEW` with pending queue entries: confirmation, cancellation, or second-stage timeout deterministically advances exactly one oldest queued message after the active outcome is delivered.
- `EXPENSE_SAVING_RETRY` → `ONBOARDING_VALIDATING_ACCESS`: `reconfigurar` restarts validation and eager column inference for the active Google spreadsheet.

Transitions that present a list or require explicit confirmation (e.g., `ONBOARDING_FILE` self-transition, `ONBOARDING_MAPPING` self-transition) do **not** use eager advance.

An authorization failure during `EXPENSE_SAVING` transitions to `ONBOARDING_START` with `promptShown: true`. The recovery copy has already instructed the user to reply `empezar`, so that next message is consumed immediately as the existing Google provider-selection alias and starts OAuth. The failed expense is not retained or replayed automatically.

---

## Transition diagram (Mermaid)

```mermaid
flowchart TD
    IDLE -->|first contact| ONBOARDING_START
    IDLE -->|expense message| EXPENSE_RECEIVING

    ONBOARDING_START -->|first prompt| ONBOARDING_START
    ONBOARDING_START -->|OAuth initiated| ONBOARDING_DRIVE
    ONBOARDING_DRIVE -->|drive linked| ONBOARDING_FILE
    ONBOARDING_FILE -->|store fileList| ONBOARDING_FILE
    ONBOARDING_FILE -->|file picked| ONBOARDING_SHEET
    ONBOARDING_SHEET -->|store sheetList| ONBOARDING_SHEET
    ONBOARDING_SHEET -->|sheet picked| ONBOARDING_VALIDATING_ACCESS
    ONBOARDING_VALIDATING_ACCESS -->|access OK| ONBOARDING_MAPPING
    ONBOARDING_VALIDATING_ACCESS -->|empty sheet| ONBOARDING_SHEET
    ONBOARDING_VALIDATING_ACCESS -->|persistent error| ONBOARDING_START
    ONBOARDING_MAPPING -->|mapping confirmed| ONBOARDING_CATEGORIES
    ONBOARDING_CATEGORIES -->|categories confirmed| IDLE

    EXPENSE_RECEIVING -->|needs clarification| EXPENSE_CLARIFYING
    EXPENSE_RECEIVING -->|complete| EXPENSE_REVIEW
    EXPENSE_RECEIVING -->|cancelled| IDLE

    EXPENSE_CLARIFYING -->|clarified| EXPENSE_REVIEW
    EXPENSE_CLARIFYING -->|cancelled| IDLE

    EXPENSE_REVIEW -->|confirmed| EXPENSE_SAVING
    EXPENSE_REVIEW -->|correction requested| EXPENSE_CORRECTING
    EXPENSE_REVIEW -->|cancelled| IDLE

    EXPENSE_CORRECTING -->|corrected| EXPENSE_REVIEW
    EXPENSE_CORRECTING -->|cancelled| IDLE

    EXPENSE_SAVING -->|success| IDLE
    EXPENSE_SAVING -->|failure| EXPENSE_SAVING_RETRY
    EXPENSE_SAVING -->|authorization failure| ONBOARDING_START

    EXPENSE_SAVING_RETRY -->|successful retry, fallback, or expiry| IDLE
    EXPENSE_SAVING_RETRY -->|reconfigurar| ONBOARDING_VALIDATING_ACCESS
```

---

## `state_payload` per state

The `state_payload` column in the `conversation_states` table is a `JSONB` blob whose shape depends on the current state. Fields that are not relevant to the current state must be `null` or absent.

| State                          | Relevant `state_payload` fields                                                                                                                                               | Meaning                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `IDLE`                         | _(empty or `{}`)_                                                                                                                                                             | Nothing to persist                                                                                                             |
| `ONBOARDING_START`             | `promptShown: boolean`, `provider?: 'google' \| 'microsoft'`                                                                                                                  | `promptShown` tracks whether the welcome/provider prompt has been displayed; authorization recovery sets it to `true` because the recovery copy already prompts for `empezar`; `provider` may be present transiently |
| `ONBOARDING_DRIVE`             | `oauth_state: string`                                                                                                                                                         | PKCE / OAuth state token for CSRF protection                                                                                   |
| `ONBOARDING_FILE`              | `drive_folder_id?: string`, `files: Array<{id, name}>`                                                                                                                        | List of candidate files to show the user                                                                                       |
| `ONBOARDING_SHEET`             | `file_id: string`, `sheets: Array<{name, id}>`                                                                                                                                | Selected file and its internal sheets                                                                                          |
| `ONBOARDING_VALIDATING_ACCESS` | `selectedFileId: string`, `selectedFileName: string`, `selectedSheetName: string`, `provider: SpreadsheetProvider`, `sheetList?: SheetInfo[]`, `step?: 'empty-sheet-confirm'` | File and sheet being validated; `step` and `sheetList` present when transitioning back to `ONBOARDING_SHEET` after empty-sheet |
| `ONBOARDING_MAPPING`           | `file_id`, `sheet_id`, `headers: string[]`, `mapping: Record<string, string>`                                                                                                 | Detected column mapping waiting for confirmation                                                                               |
| `ONBOARDING_CATEGORIES`        | `file_id`, `sheet_id`, `mapping`, `categories: string[]`                                                                                                                      | Detected category list waiting for confirmation                                                                                |
| `EXPENSE_RECEIVING`            | `raw_message: string`, `extracted?: ExtractedExpense`                                                                                                                         | The incoming message and any partial NLP result                                                                                |
| `EXPENSE_CLARIFYING`           | `raw_message`, `missing_fields: string[]`, `partial: ExtractedExpense`                                                                                                        | Which fields the user still needs to provide                                                                                   |
| `EXPENSE_REVIEW`               | `expense: ExpenseEntity`, `summary_text: string`                                                                                                                              | The fully formed expense and the summary shown to the user                                                                     |
| `EXPENSE_CORRECTING`           | `expense: ExpenseEntity`, `correction_field: string`                                                                                                                          | Which field the user wants to correct                                                                                          |
| `EXPENSE_SAVING`               | `expense: ExpenseEntity`, `attempt: number`                                                                                                                                   | Current save attempt count                                                                                                     |
| `EXPENSE_SAVING_RETRY`         | `expense: ExpenseReviewPayload`, `failureCode: 'NETWORK_ERROR' \| 'AUTH_ERROR' \| 'STRUCTURE_ERROR' \| 'UNKNOWN'`, `firstAttemptAt: ISOString`, `attemptCount: 1` | Confirmed expense retained for the sole permitted user-initiated retry; only retryable network failures enter this state |

---

## Timeouts

### How timeouts are implemented

Timeouts are **BullMQ jobs with a `delay`**, never cron jobs.

1. When entering a state that has a timeout, the FSM enqueues a BullMQ job of type `fsm-timeout` with `delay` equal to the state's TTL.
2. The job payload contains the `userId` and the `expectedState` at the time of enqueueing.
3. When the delayed job fires, the worker checks whether the user is **still** in `expectedState`.
   - If yes → transition to `IDLE` and notify the user: _"El proceso se canceló por inactividad. Escribe de nuevo cuando quieras."_
   - If no → the job is a no-op (the user already moved on).

### Timeout values

| State group                        | Timeout    | Job type                                   |
| ---------------------------------- | ---------- | ------------------------------------------ |
| Onboarding states (`ONBOARDING_*`) | 30 minutes | `fsm-timeout` with `delay: 30 * 60 * 1000` |
| `EXPENSE_CLARIFYING`               | 10 minutes | `fsm-timeout` with `delay: 10 * 60 * 1000` |
| `EXPENSE_REVIEW`                   | 10 minutes | `fsm-timeout` with `delay: 10 * 60 * 1000` |
| `EXPENSE_SAVING_RETRY`             | 10 minutes | `fsm-timeout` with `delay: 10 * 60 * 1000` |

---

## Rule: FSM exclusivity

> **Never add conditional conversational flow logic outside the FSM.**

All branching based on "what the user said" or "what step we are in" must be expressed as a state transition inside the FSM. If you find yourself writing an `if` in a service that checks `user.status === 'onboarding'` or `if (message.includes('cancelar'))`, that logic belongs inside the FSM transition table, not in the service layer.

The only place where branching on state is allowed is the **FSM engine** (`src/application/services/ConversationFSM.ts` or equivalent). Everywhere else, the code receives a state and executes the action associated with that state, without deciding what the next state should be.
