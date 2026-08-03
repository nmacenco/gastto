# Feature: Conversation State Management

## Purpose

Persist and manage the finite-state machine (FSM) that governs each user's conversational flow. The FSM determines how the system responds to incoming messages based on the user's current context — whether they are onboarding, entering an expense, reviewing a draft, or idle. Persisting state in PostgreSQL (not in memory) guarantees that multi-turn conversations survive process restarts and can be audited.

## Behavior (Implemented)

- Each user has exactly one row in `conversation_states`, referenced by `user_id` with `ON DELETE CASCADE`.
- The FSM defines **15 states** and valid transitions between them (see ADR-003 and ADR-017).
- State transitions are atomic: `DrizzleConversationStateRepository.transition` wraps the UPDATE in a transaction.
- `HandleStartCommand` ensures every new user has a valid conversation state. If missing, it creates `IDLE`.
- `TransitionConversationState` validates transitions against `FSM_TRANSITIONS`. Invalid transitions throw `InvalidStateTransitionError`.
- `GetConversationState` reads the current state for a user, returning `null` only if the user has never interacted with the system.
- **Session timeout:** `conversation_states.expires_at` stores an absolute expiration timestamp. `HandleExpiredSessions` (run by a periodic worker) finds all expired states via the partial index `idx_conversation_states_expires`, transitions them back to `IDLE`, and notifies the user via their messaging identities with the copy: `"Tu sesion expiro. Queres continuar o empezar de nuevo?"`.
- **Corrupted-state recovery:** `RecoverCorruptedState` detects an invalid state string (outside the 13 known states), logs an anomaly to `operation_logs` with `error_type = 'CORRUPTED_STATE'`, and resets the user to `IDLE`.
- Clean Architecture boundary is enforced: HTTP routes and BullMQ workers delegate to use cases; use cases own the FSM logic and call repository ports. No infrastructure adapter is accessed directly from the interface layer.

## Behavior (TODO)

- Full onboarding FSM transitions: the current `/start` implementation creates `IDLE` directly. The complete onboarding chain (`ONBOARDING_START` → `ONBOARDING_DRIVE` → `ONBOARDING_FILE` → `ONBOARDING_SHEET` → `ONBOARDING_MAPPING` → `ONBOARDING_CATEGORIES` → `IDLE`) is pending a dedicated onboarding HU.
- TODO: Implement onboarding transition use cases and update `HandleStartCommand` to create `ONBOARDING_START` when the user has no linked spreadsheet.

## API / Interface

This feature is not exposed via public HTTP endpoints. It is driven internally by use cases consumed by webhook routes and background workers.

### Use Cases (Application Layer)

| Use Case                      | Input                                           | Output                      | Responsibility                                           |
| ----------------------------- | ----------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| `HandleStartCommand`          | `{ userId, chatId, username? }`                 | `{ replyText }`             | Send welcome message and ensure an `IDLE` state exists.  |
| `GetConversationState`        | `{ userId }`                                    | `ConversationState \| null` | Read current state from the repository.                  |
| `TransitionConversationState` | `{ userId, targetState, payload?, expiresAt? }` | `ConversationState`         | Validate and execute a state transition.                 |
| `RecoverCorruptedState`       | `{ userId, observedState }`                     | `{ message, recovered }`    | Detect invalid state, log anomaly, reset to `IDLE`.      |
| `HandleExpiredSessions`       | —                                               | `void`                      | Find expired states, transition to `IDLE`, notify users. |

### Ports (Domain / Application)

- `IConversationStateRepository` — `findByUserId`, `create`, `transition`, `findExpired`.
- `IUserRepository.findMessagingIdentitiesByUserId` — resolves channels for timeout notifications.
- `IOperationLogRepository.create` — persists anomaly logs.
- `IChatMessenger.sendWelcome` — sent during `/start`.
- `MessagingOutputPort.sendMessage` — sent during session timeout recovery.

## Data Model

Primary table: `conversation_states` (1:1 with `users`).

| Column          | Type          | Constraints                        | Description                              |
| --------------- | ------------- | ---------------------------------- | ---------------------------------------- |
| `user_id`       | `UUID`        | PK, FK → `users(user_id)`, CASCADE | Owner of the state.                      |
| `current_state` | `TEXT`        | NOT NULL, default `'IDLE'`, CHECK  | One of 15 FSM states.                    |
| `state_payload` | `JSONB`       | NULL                               | Contextual data for the active flow.     |
| `entered_at`    | `TIMESTAMPTZ` | NOT NULL, default `now()`          | When the current state was entered.      |
| `expires_at`    | `TIMESTAMPTZ` | NULL                               | Absolute timeout; NULL means no timeout. |
| `updated_at`    | `TIMESTAMPTZ` | NOT NULL, default `now()`          | Last mutation timestamp.                 |

**Indexes**

- `idx_conversation_states_current` on `current_state` — operational lookups and monitoring.
- `idx_conversation_states_expires` on `expires_at` where `expires_at IS NOT NULL` — cleanup job for expired sessions.

See `docs/architecture/data-model.md` for the full schema, foreign keys, and related audit table `operation_logs`.

## FSM Reference

| State                   | Description                             | Valid Transitions                                  |
| ----------------------- | --------------------------------------- | -------------------------------------------------- |
| `IDLE`                  | No active flow                          | `ONBOARDING_START`, `EXPENSE_RECEIVING`            |
| `ONBOARDING_START`      | First contact, no spreadsheet linked    | `ONBOARDING_DRIVE`                                 |
| `ONBOARDING_DRIVE`      | Waiting for OAuth connection            | `ONBOARDING_FILE`                                  |
| `ONBOARDING_FILE`       | Waiting for file selection              | `ONBOARDING_SHEET`, `ONBOARDING_START`             |
| `ONBOARDING_SHEET`      | Waiting for sheet selection             | `ONBOARDING_VALIDATING_ACCESS`, `ONBOARDING_START` |
| `ONBOARDING_MAPPING`    | Waiting for column mapping confirmation | `ONBOARDING_CATEGORIES`, `ONBOARDING_START`        |
| `ONBOARDING_CATEGORIES` | Waiting for category confirmation       | `IDLE`                                             |
| `EXPENSE_RECEIVING`     | Message received, NLP processing        | `EXPENSE_CLARIFYING`, `EXPENSE_REVIEW`, `IDLE`     |
| `EXPENSE_CLARIFYING`    | Waiting for user clarification          | `EXPENSE_REVIEW`, `IDLE`                           |
| `EXPENSE_REVIEW`        | Summary sent, awaiting confirmation     | `EXPENSE_SAVING`, `EXPENSE_CORRECTING`, `IDLE`     |
| `EXPENSE_CORRECTING`    | Applying user correction                | `EXPENSE_REVIEW`, `IDLE`                           |
| `EXPENSE_SAVING`        | Writing to spreadsheet                  | `IDLE`, `EXPENSE_SAVING_RETRY`                     |
| `EXPENSE_SAVING_RETRY`  | Retry failed save (TTL: 10 min)         | `IDLE`                                             |
| `EXPENSE_UNDO_CONFIRMING` | Waiting for explicit delayed-undo confirmation (short TTL) | `IDLE` |

## Tests

- [x] `ConversationState.integration.spec.ts` — 5 Gherkin scenarios against a real PostgreSQL database:
  1. New user initialization via `/start` creates `IDLE` state.
  2. Valid transition to `EXPENSE_RECEIVING` with payload and expiration is persisted and readable.
  3. Session survives a simulated application restart (new DB connection).
  4. Corrupted state recovery logs `CORRUPTED_STATE` anomaly and resets to `IDLE`.
  5. Expired session transitions to `IDLE` and sends the timeout prompt.

## Related User Stories

- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.04-manage-conversation-state-per-user/HU-0.04 — Manage Conversation State per User.md`

## Notes

- The `operation_logs` table captures anomalies via `RecoverCorruptedState` with `operation = 'STATE_CORRUPTED'` and `error_type = 'CORRUPTED_STATE'`. This links the conversational FSM to the audit trail.
- `HandleExpiredSessions` iterates over all expired states and processes each user independently; a per-user failure is caught and logged without aborting the batch.
- [`expense-cancellation.md`](./expense-cancellation.md) defines global cancellation for active expense states. It clears `statePayload` and `expiresAt` when returning to `IDLE`.
- [`undo-last-expense.md`](./undo-last-expense.md) defines one-message immediate undo eligibility and the confirmation-safe `EXPENSE_UNDO_CONFIRMING` state.
- Redis is used only for identity caching (ADR-008) and BullMQ broker (ADR-005). The conversation state itself is never stored in Redis.
- The timeout prompt copy (`"Tu sesion expiro. Queres continuar o empezar de nuevo?"`) is owned by the Application layer (`HandleExpiredSessions`), not by the Telegram adapter.
