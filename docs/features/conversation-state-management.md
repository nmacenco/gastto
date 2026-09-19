# Feature: Conversation State Management

## Purpose

Persist and manage the finite-state machine (FSM) that governs each user's conversational flow. The FSM determines how the system responds to incoming messages based on the user's current context — whether they are onboarding, entering an expense, reviewing a draft, or idle. Persisting state in PostgreSQL (not in memory) guarantees that multi-turn conversations survive process restarts and can be audited.

## Behavior (Implemented)

- Each user has exactly one row in `conversation_states`, referenced by `user_id` with `ON DELETE CASCADE`.
- The FSM defines **15 states** and valid transitions between them (see ADR-003 and ADR-017).
- State transitions are atomic compare-and-swap writes over user ID, decimal-string `revision`, observed state, and database-time expiry. Each successful mutation increments the `BIGINT` revision, including self-transitions.
- `TransitionConversationState` requires an explicit observed precondition unless a shared async execution context owns the latest committed snapshot. Nested use cases reuse that context; it is invalidated if lease renewal fails.
- Per-user Redis leases are renewed every 30 seconds with token-safe comparison. Timeout, OAuth callback/reminder, recovery, onboarding, and message-processing entries share this ownership boundary.
- `HandleStartCommand` ensures every new user has a valid conversation state. If missing, it creates `IDLE`.
- `TransitionConversationState` validates transitions against `FSM_TRANSITIONS`. Invalid transitions throw `InvalidStateTransitionError`.
- `GetConversationState` reads the current state for a user, returning `null` only if the user has never interacted with the system.
- A terminal spreadsheet `AUTH_ERROR` while saving transitions directly from `EXPENSE_SAVING` to `ONBOARDING_START` with `promptShown: true`. The next contextual `empezar` message starts the existing Google OAuth flow without replaying the failed expense.
- Category confirmation and category modification recover from missing spreadsheet configuration by transitioning from `ONBOARDING_CATEGORIES` to `ONBOARDING_START` with `promptShown: true`, preserving strict transition validation while reconnecting the user contextually.
- Category confirmation always finalizes the persisted conversation as `IDLE` with `statePayload` and `expiresAt` cleared before sending completion copy. If categories were confirmed previously, only the redundant confirmation-timestamp write is skipped; user activation and the FSM transition are repeated idempotently.
- **Session timeout:** `conversation_states.expires_at` stores an absolute expiration timestamp. `HandleExpiredSessions` (run by a periodic worker) finds all expired states via the partial index `idx_conversation_states_expires`, transitions them back to `IDLE`, and notifies the user via their messaging identities with the copy: `"Tu sesion expiro. Queres continuar o empezar de nuevo?"`.
- Every onboarding state (`ONBOARDING_START`, `ONBOARDING_DRIVE`, `ONBOARDING_FILE`, `ONBOARDING_SHEET`, `ONBOARDING_VALIDATING_ACCESS`, `ONBOARDING_MAPPING`, and `ONBOARDING_CATEGORIES`) explicitly permits that timeout transition to `IDLE`; the generic handler clears `statePayload` and `expiresAt` through the strict validator before notifying the user.
- **Corrupted-state recovery:** `RecoverCorruptedState` resets only the exact invalid state/revision it observed. If another writer already advanced the row, recovery has no effect and records no false recovery audit.
- Save, retry, and undo reserve `state_payload.executionClaim` before starting a spreadsheet effect. Only the matching claim can finalize; unknown outcomes remain claimed for manual investigation and are not automatically replayed.
- Timeout reminders/cancellations are sent only after the expired snapshot transition commits. Queue advancement removes only the exact item used to create the committed successor.
- Clean Architecture boundary is enforced: HTTP routes and BullMQ workers delegate to use cases; use cases own the FSM logic and call repository ports. No infrastructure adapter is accessed directly from the interface layer.

## Behavior (TODO)

- Full onboarding FSM transitions: the current `/start` implementation creates `IDLE` directly. The complete onboarding chain (`ONBOARDING_START` → `ONBOARDING_DRIVE` → `ONBOARDING_FILE` → `ONBOARDING_SHEET` → `ONBOARDING_MAPPING` → `ONBOARDING_CATEGORIES` → `IDLE`) is pending a dedicated onboarding HU.
- TODO: Implement onboarding transition use cases and update `HandleStartCommand` to create `ONBOARDING_START` when the user has no linked spreadsheet.

## API / Interface

This feature is not exposed via public HTTP endpoints. It is driven internally by use cases consumed by webhook routes and background workers.

### Use Cases (Application Layer)

| Use Case                      | Input                                                      | Output                         | Responsibility                                                                                                 |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `HandleStartCommand`          | `{ userId, chatId, username? }`                            | `{ replyText }`                | Send welcome message and ensure an `IDLE` state exists.                                                        |
| `GetConversationState`        | `{ userId }`                                               | `ConversationState \| null`    | Read current state from the repository.                                                                        |
| `TransitionConversationState` | `{ userId, targetState, payload?, expiresAt?, expected? }` | `{ status: 'updated', state }` | Validate and execute a CAS transition. `expected` may be omitted only inside an owned async execution context. |
| `RecoverCorruptedState`       | `{ userId, observedState, observedRevision }`              | `{ message, recovered }`       | Reset only the exact corrupted snapshot to `IDLE`.                                                             |
| `HandleExpiredSessions`       | —                                                          | `void`                         | Find expired states, transition to `IDLE`, notify users.                                                       |

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
| `revision`      | `BIGINT`      | NOT NULL, default `0`              | Monotonic CAS token serialized as text.  |
| `state_payload` | `JSONB`       | NULL                               | Contextual data for the active flow.     |
| `entered_at`    | `TIMESTAMPTZ` | NOT NULL, default `now()`          | When the current state was entered.      |
| `expires_at`    | `TIMESTAMPTZ` | NULL                               | Absolute timeout; NULL means no timeout. |
| `updated_at`    | `TIMESTAMPTZ` | NOT NULL, default `now()`          | Last mutation timestamp.                 |

**Indexes**

- `idx_conversation_states_current` on `current_state` — operational lookups and monitoring.
- `idx_conversation_states_expires` on `expires_at` where `expires_at IS NOT NULL` — cleanup job for expired sessions.

See `docs/architecture/data-model.md` for the full schema, foreign keys, and related audit table `operation_logs`.

## FSM Reference

| State                          | Description                                                     | Valid Transitions                                                              |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `IDLE`                         | No active flow                                                  | `ONBOARDING_START`, `EXPENSE_RECEIVING`                                        |
| `ONBOARDING_START`             | First contact, no spreadsheet linked                            | `ONBOARDING_START`, `ONBOARDING_DRIVE`, `IDLE`                                 |
| `ONBOARDING_DRIVE`             | Waiting for OAuth connection                                    | `ONBOARDING_DRIVE`, `ONBOARDING_FILE`, `IDLE`                                  |
| `ONBOARDING_FILE`              | Waiting for file selection                                      | `ONBOARDING_FILE`, `ONBOARDING_SHEET`, `ONBOARDING_START`, `IDLE`              |
| `ONBOARDING_SHEET`             | Waiting for sheet selection                                     | `ONBOARDING_SHEET`, `ONBOARDING_VALIDATING_ACCESS`, `ONBOARDING_START`, `IDLE` |
| `ONBOARDING_VALIDATING_ACCESS` | Validating spreadsheet access                                   | `ONBOARDING_MAPPING`, `ONBOARDING_SHEET`, `ONBOARDING_START`, `IDLE`           |
| `ONBOARDING_MAPPING`           | Waiting for column mapping confirmation                         | `ONBOARDING_MAPPING`, `ONBOARDING_CATEGORIES`, `ONBOARDING_START`, `IDLE`      |
| `ONBOARDING_CATEGORIES`        | Waiting for category confirmation                               | `IDLE`, `ONBOARDING_CATEGORIES`, `ONBOARDING_START`                            |
| `EXPENSE_RECEIVING`            | Message received, NLP processing                                | `EXPENSE_CLARIFYING`, `EXPENSE_REVIEW`, `IDLE`                                 |
| `EXPENSE_CLARIFYING`           | Waiting for user clarification                                  | `EXPENSE_REVIEW`, `IDLE`                                                       |
| `EXPENSE_REVIEW`               | Summary sent, awaiting confirmation                             | `EXPENSE_SAVING`, `EXPENSE_CORRECTING`, `IDLE`                                 |
| `EXPENSE_CORRECTING`           | Applying user correction                                        | `EXPENSE_REVIEW`, `IDLE`                                                       |
| `EXPENSE_SAVING`               | Writing to spreadsheet or retaining an unresolved save claim    | `EXPENSE_SAVING`, `IDLE`, `EXPENSE_SAVING_RETRY`, `ONBOARDING_START`           |
| `EXPENSE_SAVING_RETRY`         | Retry failed save (TTL: 10 min)                                 | `EXPENSE_SAVING_RETRY`, `IDLE`, `ONBOARDING_VALIDATING_ACCESS`                 |
| `EXPENSE_UNDO_CONFIRMING`      | Waiting for a bound delayed-undo confirmation (five-minute TTL) | `EXPENSE_UNDO_CONFIRMING`, `IDLE`                                              |

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
- When an `EXPENSE_REVIEW` has pending rows in `expense_queue`, the first expiry keeps the review active for one further timeout and includes the pending count in its reminder. The second expiry removes only the active draft, then advances the oldest queued expense through the normal interpretation and review flow.
- `EXPENSE_REVIEW` payloads bind authorization to an opaque operation ID, a review revision, and a nullable successful-presentation timestamp. Corrections, zero/high-amount stage changes, grace reminders, replacements, and safe re-presentations invalidate older evidence by advancing the binding.
- Enabled semantic actions are available in the delivered expense states, `ONBOARDING_FILE/default`, and `ONBOARDING_SHEET/default|idk` for revision-bound displayed-option selection. Phase 2 additionally enables natural cancellation in the four active expense-draft states and inferred undo in `IDLE`. Each control dispatcher revalidates revision, state, substep, expiry, execution ownership, and the state-specific payload before one typed path. Exact cancellation/undo commands, callbacks, numeric selection, file search, direct URLs, sheet IDK/header descriptions, single-sheet auto-selection, empty-sheet confirmation, undo confirmation, and retry remain deterministic.
- PostgreSQL/Redis integration covers stale revision while routing/extraction is pending, renewable-lease loss, lock contention, duplicate webhook delivery, active clarification/review rollback, queue advancement, and corrected-binding replacement without a state or queue migration.
- Clarification completion and replacement preserve `queueRegisteredCount`; successful review correction spreads the same review payload metadata; save increments it before FIFO advancement, while cancellation advances without incrementing it.
- `EXPENSE_UNDO_CONFIRMING` and `EXPENSE_SAVING_RETRY` use the same strict operation ID/revision/presentation shape as a separate action binding. Their self-transitions persist successful delivery or safe legacy re-presentation; only a later channel timestamp can be consumed into the matching financial claim.
- Natural undo never consumes `IDLE.immediateUndoExpenseId`: it creates a new five-minute, initially unpresented undo binding and sets `presentedAt` only after delivery succeeds. A failed or raced delivery remains unbound and cannot authorize deletion.
- Natural retry preserves the exact `EXPENSE_SAVING_RETRY` row and binding until a later exact command. Semantic reconfiguration supplies the captured revision/state/expiry precondition to the existing transition. Off/shadow rollback therefore leaves active review, retry, undo-confirming, queue, expiry, and financial-claim data usable by deterministic handlers without payload rewrites.
- Expiry is checked during action resolution, not only by the periodic sweep. An expired action cannot revive the review; the first-expiry path creates a new binding and the second expiry clears only the matching active draft.
- All queue-aware user feedback is emitted in Spanish, including capacity rejection, pending-count notices, unrelated-reply reminders, expiration advances, and final batch summaries. Count-aware copies use singular and plural forms as appropriate.
- The timeout prompt copy (`"Tu sesion expiro. Queres continuar o empezar de nuevo?"`) is owned by the Application layer (`HandleExpiredSessions`), not by the Telegram adapter.
