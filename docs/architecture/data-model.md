# Data Model

The MVP schema consists of 10 tables grouped into five functional areas: user identity, conversational state, OAuth tokens, spreadsheet configuration, and expense records plus audit logs. All tables use UUID primary keys with `gen_random_uuid()` defaults and `TIMESTAMPTZ` timestamps. PostgreSQL `TEXT` with `CHECK` constraints is preferred over native `ENUM` types to simplify future migrations.

## Entity Graph

`users` is the anchor table. Every other table references it directly or indirectly via `ON DELETE CASCADE`.

```
users
├── messaging_identities        (1:N — channel identity lookup)
├── conversation_states         (1:1 — FSM state per user)
├── expense_queue               (1:N — pending expense FIFO)
├── oauth_tokens                (1:N — one row per provider)
├── spreadsheet_configs         (1:1 — one active spreadsheet)
│     ├── column_mappings       (1:N — field-to-column map)
│     └── user_categories       (1:N — category vocabulary)
├── expense_records             (1:N — saved expenses, soft delete)
└── operation_logs              (1:N — immutable audit trail)
```

## Tables

### users

Anchor entity for every user in the system.

| Column             | Type          | Constraints                             | Description                                                                                  |
| ------------------ | ------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `user_id`          | `UUID`        | PK, default `gen_random_uuid()`         | Internal stable identifier. Never exposed to end users.                                      |
| `status`           | `TEXT`        | NOT NULL, default `'onboarding'`, CHECK | `'onboarding'`, `'active'`, or `'suspended'`.                                                |
| `default_currency` | `TEXT`        | NULL, CHECK                             | Fallback currency. NULL until configured. Allowed: `ARS`, `EUR`, `USD`, `MXN`, `GBP`, `BRL`. |
| `created_at`       | `TIMESTAMPTZ` | NOT NULL, default `now()`               | Record creation timestamp.                                                                   |
| `updated_at`       | `TIMESTAMPTZ` | NOT NULL, default `now()`               | Last mutation timestamp.                                                                     |

### messaging_identities

Maps external channel identifiers to the internal `user_id`.

| Column        | Type          | Constraints                     | Description                                  |
| ------------- | ------------- | ------------------------------- | -------------------------------------------- |
| `id`          | `UUID`        | PK, default `gen_random_uuid()` | Row identifier.                              |
| `user_id`     | `UUID`        | FK → `users(user_id)`, CASCADE  | Reference to the internal user.              |
| `channel`     | `TEXT`        | NOT NULL, CHECK                 | `'telegram'` or `'whatsapp'`.                |
| `external_id` | `TEXT`        | NOT NULL                        | Telegram `chat_id` or WhatsApp E.164 number. |
| `linked_at`   | `TIMESTAMPTZ` | NOT NULL, default `now()`       | When the identity was linked.                |
| **UNIQUE**    | —             | `(channel, external_id)`        | One external identity per channel.           |

### conversation_states

Persisted finite-state machine (FSM) state for each user. One row per user.

| Column          | Type          | Constraints                        | Description                                                    |
| --------------- | ------------- | ---------------------------------- | -------------------------------------------------------------- |
| `user_id`       | `UUID`        | PK, FK → `users(user_id)`, CASCADE | 1:1 with the user.                                             |
| `current_state` | `TEXT`        | NOT NULL, default `'IDLE'`, CHECK  | One of 14 FSM states defined in ADR-003.                       |
| `state_payload` | `JSONB`       | NULL                               | State context: expense in progress, onboarding data, etc.      |
| `entered_at`    | `TIMESTAMPTZ` | NOT NULL, default `now()`          | When the current state was entered.                            |
| `expires_at`    | `TIMESTAMPTZ` | NULL                               | Absolute expiration for timed states (e.g., `EXPENSE_REVIEW`). |
| `updated_at`    | `TIMESTAMPTZ` | NOT NULL, default `now()`          | Last state mutation.                                           |

### expense_queue

FIFO queue of pending expense messages while a user is in a blocking conversational state.

| Column        | Type          | Constraints                       | Description                                        |
| ------------- | ------------- | --------------------------------- | -------------------------------------------------- |
| `id`          | `UUID`        | PK, default `gen_random_uuid()`   | Row identifier.                                    |
| `user_id`     | `UUID`        | FK → `users(user_id)`, CASCADE    | Queue owner.                                       |
| `position`    | `SMALLINT`    | NOT NULL, CHECK `BETWEEN 1 AND 2` | Queue position. Enforced limit of 2 pending items. |
| `raw_message` | `TEXT`        | NOT NULL                          | Original unprocessed message.                      |
| `received_at` | `TIMESTAMPTZ` | NOT NULL, default `now()`         | Reception timestamp.                               |
| `channel`     | `TEXT`        | NOT NULL, CHECK                   | `'telegram'` or `'whatsapp'`.                      |
| **UNIQUE**    | —             | `(user_id, position)`             | Optimistic lock against double enqueue.            |

### oauth_tokens

Encrypted OAuth 2.0 tokens for Google Drive and OneDrive access.

| Column                    | Type          | Constraints                     | Description                                            |
| ------------------------- | ------------- | ------------------------------- | ------------------------------------------------------ |
| `id`                      | `UUID`        | PK, default `gen_random_uuid()` | Row identifier.                                        |
| `user_id`                 | `UUID`        | FK → `users(user_id)`, CASCADE  | Token owner.                                           |
| `provider`                | `TEXT`        | NOT NULL, CHECK                 | `'google'` or `'microsoft'`.                           |
| `access_token_enc`        | `BYTEA`       | NOT NULL                        | AES-256-GCM encrypted access token.                    |
| `refresh_token_enc`       | `BYTEA`       | NOT NULL                        | AES-256-GCM encrypted refresh token.                   |
| `iv`                      | `BYTEA`       | NOT NULL                        | Initialization vector for the access token ciphertext. |
| `refresh_iv`              | `BYTEA`       | NOT NULL                        | Initialization vector for the refresh token ciphertext.|
| `access_token_expires_at` | `TIMESTAMPTZ` | NOT NULL                        | Plaintext expiry used for proactive refresh decisions. |
| `scope`                   | `TEXT[]`      | NOT NULL, default `'{}'`        | Granted OAuth scopes.                                  |
| `granted_at`              | `TIMESTAMPTZ` | NOT NULL, default `now()`       | Consent timestamp.                                     |
| `last_refreshed_at`       | `TIMESTAMPTZ` | NULL                            | Last refresh timestamp.                                |
| `revoked_at`              | `TIMESTAMPTZ` | NULL                            | NULL = active; set = revoked.                          |
| **UNIQUE**                | —             | `(user_id, provider)`           | One token set per provider.                            |

### spreadsheet_configs

Linked spreadsheet configuration per user.

| Column               | Type          | Constraints                            | Description                                 |
| -------------------- | ------------- | -------------------------------------- | ------------------------------------------- |
| `id`                 | `UUID`        | PK, default `gen_random_uuid()`        | Row identifier.                             |
| `user_id`            | `UUID`        | FK → `users(user_id)`, CASCADE, UNIQUE | One active spreadsheet per user in the MVP. |
| `provider`           | `TEXT`        | NOT NULL, CHECK                        | `'google'` or `'microsoft'`.                |
| `file_id`            | `TEXT`        | NOT NULL                               | External file identifier.                   |
| `file_name`          | `TEXT`        | NOT NULL                               | Human-readable file name for display.       |
| `sheet_name`         | `TEXT`        | NOT NULL                               | Target sheet within the file.               |
| `access_verified_at`  | `TIMESTAMPTZ` | NOT NULL                               | Last read/write permission check.           |
| `categories_confirmed_at` | `TIMESTAMPTZ` | NULL                               | Timestamp when the user confirmed their category vocabulary. NULL until confirmation. |
| `created_at`         | `TIMESTAMPTZ` | NOT NULL, default `now()`              | Creation timestamp.                         |
| `updated_at`         | `TIMESTAMPTZ` | NOT NULL, default `now()`              | Last update timestamp.                      |

### column_mappings

Maps canonical Gastto fields to real spreadsheet column indices.

| Column           | Type          | Constraints                             | Description                                                                         |
| ---------------- | ------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| `id`             | `UUID`        | PK, default `gen_random_uuid()`         | Row identifier.                                                                     |
| `spreadsheet_id` | `UUID`        | FK → `spreadsheet_configs(id)`, CASCADE | Parent spreadsheet.                                                                 |
| `gastto_field`   | `TEXT`        | NOT NULL, CHECK                         | Canonical field: `monto`, `moneda`, `categoria`, `fecha`, `concepto`, `medio_pago`. |
| `column_index`   | `SMALLINT`    | NOT NULL                                | Zero-based column index in the sheet.                                               |
| `column_header`  | `TEXT`        | NOT NULL                                | Detected header name for display and debugging.                                     |
| `inferred`       | `BOOLEAN`     | NOT NULL, default `true`                | `true` = LLM inferred; `false` = user corrected.                                    |
| `confirmed_at`   | `TIMESTAMPTZ` | NULL                                    | NULL = pending confirmation.                                                        |
| **UNIQUE**       | —             | `(spreadsheet_id, gastto_field)`        | One mapping per field.                                                              |
| **UNIQUE**       | —             | `(spreadsheet_id, column_index)`        | One field per column index.                                                         |

### user_categories

Per-spreadsheet category vocabulary used for semantic mapping.

| Column             | Type          | Constraints                             | Description                               |
| ------------------ | ------------- | --------------------------------------- | ----------------------------------------- |
| `id`               | `UUID`        | PK, default `gen_random_uuid()`         | Row identifier.                           |
| `spreadsheet_id`   | `UUID`        | FK → `spreadsheet_configs(id)`, CASCADE | Parent spreadsheet.                       |
| `raw_value`        | `TEXT`        | NOT NULL                                | Exact cell value written to the sheet.    |
| `normalized_value` | `TEXT`        | NOT NULL                                | Lowercase, unaccented value for matching. |
| `usage_count`      | `INTEGER`     | NOT NULL, default `0`                   | Usage counter for ranking.                |
| `is_active`        | `BOOLEAN`     | NOT NULL, default `true`                | Soft-disable without deleting history.    |
| `created_at`       | `TIMESTAMPTZ` | NOT NULL, default `now()`               | Creation timestamp.                       |
| **UNIQUE**         | —             | `(spreadsheet_id, normalized_value)`    | One normalized entry per spreadsheet.     |

### expense_records

Immutable record of every successfully saved expense. Enables undo and future query features.

| Column                 | Type            | Constraints                               | Description                                       |
| ---------------------- | --------------- | ----------------------------------------- | ------------------------------------------------- |
| `id`                   | `UUID`          | PK, default `gen_random_uuid()`           | Row identifier.                                   |
| `user_id`              | `UUID`          | FK → `users(user_id)`, CASCADE            | Expense owner.                                    |
| `spreadsheet_id`       | `UUID`          | FK → `spreadsheet_configs(id)`, NO ACTION | Preserves history if the spreadsheet is unlinked. |
| `concepto`             | `TEXT`          | NOT NULL                                  | Expense description.                              |
| `monto`                | `NUMERIC(14,2)` | NOT NULL, CHECK `>= 0`                    | Expense amount.                                   |
| `moneda`               | `TEXT`          | NOT NULL, CHECK                           | `ARS`, `EUR`, `USD`, `MXN`, `GBP`, `BRL`.         |
| `categoria`            | `TEXT`          | NULL                                      | Mapped category. NULL if unassigned.              |
| `fecha_gasto`          | `DATE`          | NOT NULL                                  | User-facing expense date.                         |
| `medio_pago`           | `TEXT`          | NULL                                      | Payment method.                                   |
| `sheet_name`           | `TEXT`          | NOT NULL                                  | Target sheet at save time.                        |
| `row_index`            | `INTEGER`       | NOT NULL                                  | Sheet row index returned by `appendRow`.          |
| `categoria_confidence` | `TEXT`          | NULL, CHECK                               | `alta`, `baja`, `nula`, or NULL.                  |
| `raw_message`          | `TEXT`          | NOT NULL                                  | Original user message for audit.                  |
| `is_deleted`           | `BOOLEAN`       | NOT NULL, default `false`                 | Soft delete flag.                                 |
| `deleted_at`           | `TIMESTAMPTZ`   | NULL                                      | Undo timestamp.                                   |
| `created_at`           | `TIMESTAMPTZ`   | NOT NULL, default `now()`                 | Internal creation timestamp.                      |
| `saved_at`             | `TIMESTAMPTZ`   | NOT NULL, default `now()`                 | Successful sheet append timestamp.                |

### operation_logs

Immutable audit trail of critical operations.

| Column       | Type          | Constraints                     | Description                                                                                                                                                  |
| ------------ | ------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`         | `UUID`        | PK, default `gen_random_uuid()` | Row identifier.                                                                                                                                              |
| `user_id`    | `UUID`        | FK → `users(user_id)`, CASCADE  | Operation actor.                                                                                                                                             |
| `operation`  | `TEXT`        | NOT NULL, CHECK                 | `EXPENSE_SAVED`, `EXPENSE_DELETED`, `EXPENSE_SAVE_FAILED`, `TOKEN_REFRESHED`, `TOKEN_REVOKED`, `ONBOARDING_COMPLETED`, `MAPPING_UPDATED`, `STATE_CORRUPTED`. |
| `payload`    | `JSONB`       | NULL                            | Contextual operation data.                                                                                                                                   |
| `error_type` | `TEXT`        | NULL, CHECK                     | `NETWORK_ERROR`, `AUTH_ERROR`, `STRUCTURE_ERROR`, `CORRUPTED_STATE`. Only for failure operations.                                                            |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `now()`       | Operation timestamp.                                                                                                                                         |

## Indexes

### Full indexes

| Index                             | Table                  | Columns                                     | Purpose                                               |
| --------------------------------- | ---------------------- | ------------------------------------------- | ----------------------------------------------------- |
| `idx_users_status`                | `users`                | `status`                                    | Maintenance and reporting queries.                    |
| `idx_messaging_identities_lookup` | `messaging_identities` | `channel`, `external_id`                    | Gateway identity resolution on every inbound message. |
| `idx_messaging_identities_user`   | `messaging_identities` | `user_id`                                   | Retrieve all identities of a user.                    |
| `idx_conversation_states_current` | `conversation_states`  | `current_state`                             | Operational lookups and monitoring.                   |
| `idx_expense_queue_user_position` | `expense_queue`        | `user_id`, `position`                       | Read a user's queue in order.                         |
| `idx_oauth_tokens_user_provider`  | `oauth_tokens`         | `user_id`, `provider`                       | Token lookup on every spreadsheet operation.          |
| `idx_spreadsheet_configs_user`    | `spreadsheet_configs`  | `user_id`                                   | Lookup user's linked spreadsheet.                     |
| `idx_column_mappings_spreadsheet` | `column_mappings`      | `spreadsheet_id`                            | Load all mappings for a spreadsheet.                  |
| `idx_expense_records_sheet_row`   | `expense_records`      | `spreadsheet_id`, `sheet_name`, `row_index` | Deterministic row reference for undo.                 |
| `idx_operation_logs_user_created` | `operation_logs`       | `user_id`, `created_at`                     | User audit history.                                   |

### Partial indexes

| Index                             | Table                 | Columns                   | `WHERE` clause                      | Purpose                              |
| --------------------------------- | --------------------- | ------------------------- | ----------------------------------- | ------------------------------------ |
| `idx_conversation_states_expires` | `conversation_states` | `expires_at`              | `expires_at IS NOT NULL`            | Cleanup job for expired states.      |
| `idx_oauth_tokens_expires`        | `oauth_tokens`        | `access_token_expires_at` | `revoked_at IS NULL`                | Proactive refresh detection.         |
| `idx_user_categories_spreadsheet` | `user_categories`     | `spreadsheet_id`          | `is_active = true`                  | Active category lookups.             |
| `idx_expense_records_user_latest` | `expense_records`     | `user_id`, `saved_at`     | `is_deleted = false`                | Undo: last non-deleted expense.      |
| `idx_expense_records_user_fecha`  | `expense_records`     | `user_id`, `fecha_gasto`  | `is_deleted = false`                | Future historical queries by period. |
| `idx_operation_logs_failures`     | `operation_logs`      | `created_at`              | `operation = 'EXPENSE_SAVE_FAILED'` | Failure alerting and monitoring.     |

## Foreign Keys and `ON DELETE` Behavior

| Child Table            | Column           | Parent Table          | `ON DELETE` | Rationale                                                             |
| ---------------------- | ---------------- | --------------------- | ----------- | --------------------------------------------------------------------- |
| `messaging_identities` | `user_id`        | `users`               | `CASCADE`   | Remove channel identities when a user is deleted.                     |
| `conversation_states`  | `user_id`        | `users`               | `CASCADE`   | Remove FSM state when a user is deleted.                              |
| `expense_queue`        | `user_id`        | `users`               | `CASCADE`   | Drop queued items when a user is deleted.                             |
| `oauth_tokens`         | `user_id`        | `users`               | `CASCADE`   | Remove tokens when a user is deleted.                                 |
| `spreadsheet_configs`  | `user_id`        | `users`               | `CASCADE`   | Remove spreadsheet config when a user is deleted.                     |
| `column_mappings`      | `spreadsheet_id` | `spreadsheet_configs` | `CASCADE`   | Delete mappings with their spreadsheet.                               |
| `user_categories`      | `spreadsheet_id` | `spreadsheet_configs` | `CASCADE`   | Delete categories with their spreadsheet.                             |
| `expense_records`      | `user_id`        | `users`               | `CASCADE`   | Remove expenses when a user is deleted.                               |
| `expense_records`      | `spreadsheet_id` | `spreadsheet_configs` | `NO ACTION` | Intentionally preserves expense history if a spreadsheet is unlinked. |
| `operation_logs`       | `user_id`        | `users`               | `CASCADE`   | Remove audit trail when a user is deleted.                            |

## Domain Aggregates

### CategoryVocabulary

Aggregate root that encapsulates the full set of categories for a single spreadsheet. Enforces the invariant that no two categories can share the same normalized name (case-insensitive).

| Method            | Arguments                          | Behavior                                                                |
| ----------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `addCategory`     | `name: string`                     | Creates a new `Category` after trimming and lowercasing. Rejects duplicates and empty names. |
| `removeCategory`  | `id: string`                       | Removes the category with the given id from the vocabulary.             |
| `renameCategory`  | `id: string`, `newName: string`    | Updates the name and normalized name. Replicates addCategory validation. |

The aggregate is persisted via `ICategoryVocabularyRepository`, which translates between the aggregate and the `user_categories` table rows. The repository diffs the aggregate against the database on `save`: categories not in the aggregate are soft-deleted (`is_active = false`), new categories are inserted, and existing ones are updated via upsert on the unique `(spreadsheet_id, normalized_value)` constraint.

## Design Decisions

- **TEXT with CHECK over ENUM.** PostgreSQL `ENUM` types require `ALTER TYPE` to add values. A `CHECK` constraint can be updated with a simple `ALTER TABLE`, simplifying migrations when Release 2 introduces new states or operations.
- **Double validation on `expense_queue.position`.** The limit of 2 pending items is validated in Application logic and enforced by the database `CHECK (position BETWEEN 1 AND 2)` as a safety net.
- **Partial indexes for hot queries.** Indexes with `WHERE` clauses reduce index size and improve read performance for the most frequent access patterns: active categories, non-deleted expenses, and expired conversation states.
- **`expense_records.spreadsheet_id` uses `ON DELETE NO ACTION`.** This is the only non-cascading foreign key. It preserves the internal expense history even if the user unlinks or deletes a spreadsheet configuration, supporting future analytics and audit requirements.
- **AES-256-GCM token storage.** OAuth tokens are encrypted at rest with a per-row IV. The encryption key is a runtime secret; the database contains no plaintext credentials. See ADR-007.
- **Placeholder `access_verified_at` on first creation (Option A).** When `spreadsheet_configs` is first created during HU-4.03 sheet selection, `access_verified_at` is initialized to the current timestamp as a placeholder. The real read/write permission verification is performed later during HU-4.04 and the timestamp is updated to the actual verification time via `updateAccessVerified`. This allows the record to be persisted immediately while keeping the verification step separate.
- **Config replaced on re-onboarding via upsert.** When a user re-onboards (e.g., after an expired OAuth token), `ISpreadsheetConfigRepository.upsertByUserId` transparently replaces the existing row via `ON CONFLICT (user_id) DO UPDATE`, avoiding `uq_user_spreadsheet` violations. The `create` method remains for first-time users only.
- **Aggregate-oriented category repository.** `ICategoryVocabularyRepository` provides aggregate-level operations (`findBySpreadsheetId`, `save`) while `IUserCategoryRepository` continues to expose row-level operations (`findActiveBySpreadsheetId`, `upsertMany`, `incrementUsage`). Both interfaces are implemented by separate Drizzle repository classes operating on the same `user_categories` table, keeping the Domain and Application layers clean of ORM details.

## Related ADRs

- [ADR-003: Conversational State — FSM Persisted in PostgreSQL](../adr/adr.md#adr-003--estado-conversacional-fsm-persistida-en-postgresql) — Defines the 14 FSM states stored in `conversation_states`.
- [ADR-004: Spreadsheet Integration — Adapter Pattern](../adr/adr.md#adr-004--integración-con-planillas-adapter-pattern) — Motivates `spreadsheet_configs`, `column_mappings`, and dynamic column mapping.
- [ADR-007: Security — OAuth Token Storage with AES-256](../adr/adr.md#adr-007--seguridad-almacenamiento-de-tokens-oauth-con-aes-256) — Describes the encryption strategy for `oauth_tokens`.
- [ADR-008: User Identity — Local Registration with Own userId](../adr/adr.md#adr-008--identidad-de-usuario-registro-local-con-userid-propio) — Explains the `users` / `messaging_identities` split and the internal `user_id` anchor.
