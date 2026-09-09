# Data Model

The schema consists of 11 tables grouped into five functional areas: user identity, conversational state, OAuth tokens, spreadsheet configuration, and expense records plus audit logs. All tables use UUID primary keys with `gen_random_uuid()` defaults and `TIMESTAMPTZ` timestamps. PostgreSQL `TEXT` with `CHECK` constraints is preferred over native `ENUM` types to simplify future migrations.

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
│           └── user_subcategories (1:N — linked subcategory vocabulary)
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

`expense_queue` is independent from `conversation_states`: it stores at most two pending messages while the FSM stores exactly one active expense flow. Dequeueing shifts the remaining positions in the same transaction so the next item is always FIFO.

### oauth_tokens

Encrypted OAuth 2.0 tokens for Google Drive and OneDrive access.

| Column                    | Type          | Constraints                     | Description                                             |
| ------------------------- | ------------- | ------------------------------- | ------------------------------------------------------- |
| `id`                      | `UUID`        | PK, default `gen_random_uuid()` | Row identifier.                                         |
| `user_id`                 | `UUID`        | FK → `users(user_id)`, CASCADE  | Token owner.                                            |
| `provider`                | `TEXT`        | NOT NULL, CHECK                 | `'google'` or `'microsoft'`.                            |
| `access_token_enc`        | `BYTEA`       | NOT NULL                        | AES-256-GCM encrypted access token.                     |
| `refresh_token_enc`       | `BYTEA`       | NOT NULL                        | AES-256-GCM encrypted refresh token.                    |
| `iv`                      | `BYTEA`       | NOT NULL                        | Initialization vector for the access token ciphertext.  |
| `refresh_iv`              | `BYTEA`       | NOT NULL                        | Initialization vector for the refresh token ciphertext. |
| `access_token_expires_at` | `TIMESTAMPTZ` | NOT NULL                        | Plaintext expiry used for proactive refresh decisions.  |
| `scope`                   | `TEXT[]`      | NOT NULL, default `'{}'`        | Granted OAuth scopes.                                   |
| `granted_at`              | `TIMESTAMPTZ` | NOT NULL, default `now()`       | Consent timestamp.                                      |
| `last_refreshed_at`       | `TIMESTAMPTZ` | NULL                            | Last refresh timestamp.                                 |
| `revoked_at`              | `TIMESTAMPTZ` | NULL                            | NULL = active; set = revoked.                           |
| **UNIQUE**                | —             | `(user_id, provider)`           | One token set per provider.                             |

### spreadsheet_configs

Linked spreadsheet configuration per user.

| Column                    | Type          | Constraints                            | Description                                                                           |
| ------------------------- | ------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| `id`                      | `UUID`        | PK, default `gen_random_uuid()`        | Row identifier.                                                                       |
| `user_id`                 | `UUID`        | FK → `users(user_id)`, CASCADE, UNIQUE | One active spreadsheet per user in the MVP.                                           |
| `provider`                | `TEXT`        | NOT NULL, CHECK                        | `'google'` or `'microsoft'`.                                                          |
| `file_id`                 | `TEXT`        | NOT NULL                               | External file identifier.                                                             |
| `file_name`               | `TEXT`        | NOT NULL                               | Human-readable file name for display.                                                 |
| `sheet_name`              | `TEXT`        | NOT NULL                               | Target sheet within the file.                                                         |
| `access_verified_at`      | `TIMESTAMPTZ` | NOT NULL                               | Last read/write permission check.                                                     |
| `categories_confirmed_at` | `TIMESTAMPTZ` | NULL                                   | Timestamp when the user confirmed their category vocabulary. NULL until confirmation. |
| `created_at`              | `TIMESTAMPTZ` | NOT NULL, default `now()`              | Creation timestamp.                                                                   |
| `updated_at`              | `TIMESTAMPTZ` | NOT NULL, default `now()`              | Last update timestamp.                                                                |

### column_mappings

Maps canonical Gastto fields to real spreadsheet column indices.

| Column           | Type          | Constraints                             | Description                                                                                         |
| ---------------- | ------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `id`             | `UUID`        | PK, default `gen_random_uuid()`         | Row identifier.                                                                                     |
| `spreadsheet_id` | `UUID`        | FK → `spreadsheet_configs(id)`, CASCADE | Parent spreadsheet.                                                                                 |
| `gastto_field`   | `TEXT`        | NOT NULL, CHECK                         | Canonical field: `monto`, `moneda`, `categoria`, `fecha`, `concepto`, `medio_pago`, `subcategoria`. |
| `column_index`   | `SMALLINT`    | NOT NULL                                | Zero-based column index in the sheet.                                                               |
| `column_header`  | `TEXT`        | NOT NULL                                | Detected header name for display and debugging.                                                     |
| `inferred`       | `BOOLEAN`     | NOT NULL, default `true`                | `true` = LLM inferred; `false` = user corrected.                                                    |
| `confirmed_at`   | `TIMESTAMPTZ` | NULL                                    | NULL = pending confirmation.                                                                        |
| **UNIQUE**       | —             | `(spreadsheet_id, gastto_field)`        | One mapping per field.                                                                              |
| **UNIQUE**       | —             | `(spreadsheet_id, column_index)`        | One field per column index.                                                                         |

Migration `0008_add_subcategory_mapping_field.sql` additively replaces only `chk_gastto_field` so it admits optional `subcategoria`; existing category-only mappings remain valid. The migration was generated with Drizzle's custom-migration scaffold because the pinned Drizzle Kit version does not diff PostgreSQL `CHECK` expressions, and its snapshot and journal entry remain part of the generated migration history.

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

### user_subcategories

Per-category subcategory vocabulary. Every configured subcategory belongs to exactly one category.

| Column             | Type          | Constraints                         | Description                                       |
| ------------------ | ------------- | ----------------------------------- | ------------------------------------------------- |
| `id`               | `UUID`        | PK, default `gen_random_uuid()`     | Stable subcategory identifier.                    |
| `category_id`      | `UUID`        | FK → `user_categories(id)`, CASCADE | Required parent category.                         |
| `raw_value`        | `TEXT`        | NOT NULL                            | Exact display and spreadsheet value.              |
| `normalized_value` | `TEXT`        | NOT NULL                            | Normalized value used for parent-scoped matching. |
| `usage_count`      | `INTEGER`     | NOT NULL, default `0`               | Usage counter for ranking.                        |
| `is_active`        | `BOOLEAN`     | NOT NULL, default `true`            | Soft-disable without deleting historical links.   |
| `created_at`       | `TIMESTAMPTZ` | NOT NULL, default `now()`           | Record creation timestamp.                        |
| **UNIQUE**         | —             | `(category_id, normalized_value)`   | One normalized child per parent category.         |

### expense_records

Immutable record of every successfully saved expense. Enables undo and future query features.

| Column                 | Type            | Constraints                                   | Description                                                            |
| ---------------------- | --------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| `id`                   | `UUID`          | PK, default `gen_random_uuid()`               | Row identifier.                                                        |
| `user_id`              | `UUID`          | FK → `users(user_id)`, CASCADE                | Expense owner.                                                         |
| `spreadsheet_id`       | `UUID`          | FK → `spreadsheet_configs(id)`, NO ACTION     | Preserves history if the spreadsheet is unlinked.                      |
| `concepto`             | `TEXT`          | NOT NULL                                      | Expense description.                                                   |
| `monto`                | `NUMERIC(14,2)` | NOT NULL, CHECK `>= 0`                        | Expense amount.                                                        |
| `moneda`               | `TEXT`          | NOT NULL, CHECK                               | `ARS`, `EUR`, `USD`, `MXN`, `GBP`, `BRL`.                              |
| `categoria`            | `TEXT`          | NULL                                          | Category text snapshot at save time.                                   |
| `category_id`          | `UUID`          | NULL, FK → `user_categories(id)`, SET NULL    | Stable category reference when available.                              |
| `subcategory_id`       | `UUID`          | NULL, FK → `user_subcategories(id)`, SET NULL | Stable subcategory reference when available.                           |
| `subcategoria`         | `TEXT`          | NULL                                          | Subcategory text snapshot at save time.                                |
| `fecha_gasto`          | `DATE`          | NOT NULL                                      | User-facing expense date.                                              |
| `medio_pago`           | `TEXT`          | NULL                                          | Payment method.                                                        |
| `sheet_name`           | `TEXT`          | NOT NULL                                      | Target sheet at save time.                                             |
| `row_index`            | `INTEGER`       | NULL                                          | Sheet row index returned by `appendRow`, when the provider exposes it. |
| `categoria_confidence` | `TEXT`          | NULL, CHECK                                   | `alta`, `baja`, `nula`, or NULL.                                       |
| `raw_message`          | `TEXT`          | NOT NULL                                      | Original user message for audit.                                       |
| `is_deleted`           | `BOOLEAN`       | NOT NULL, default `false`                     | Soft delete flag.                                                      |
| `deleted_at`           | `TIMESTAMPTZ`   | NULL                                          | Undo timestamp.                                                        |
| `created_at`           | `TIMESTAMPTZ`   | NOT NULL, default `now()`                     | Internal creation timestamp.                                           |
| `saved_at`             | `TIMESTAMPTZ`   | NOT NULL, default `now()`                     | Successful sheet append timestamp.                                     |

#### Expense hierarchy lifecycle

1. Interpretation and correction carry nullable stable category/subcategory IDs, display names, independent statuses, and the hierarchy capability in the canonical review payload.
2. Confirmation builds the spreadsheet row from confirmed mappings. `subcategoria` is written only when that optional mapping exists; otherwise the row shape is unchanged.
3. The provider-confirmed append happens before local persistence. A failed append writes no `expense_records` row and establishes no immediate-undo identity.
4. A successful append creates one local row with the reviewed IDs and immutable `categoria`/`subcategoria` snapshots, then records the returned sheet and optional row index for deterministic undo.
5. Vocabulary rename, move, or deactivation does not rewrite expense history. Hard deletion clears nullable references through `ON DELETE SET NULL`; snapshots remain the save-time text.
6. Rows created before migration `0007_material_eternals.sql` remain null in `category_id`, `subcategory_id`, and `subcategoria`. No display-text inference or backfill is performed.

Retry envelopes preserve and normalize the complete reviewed hierarchy before replay, while the pending-expense queue stores raw messages only. Undo selects by the persisted expense ID and confirmed spreadsheet location, never by category/subcategory vocabulary or snapshots. These ordering and history rules remain aligned with ADR-006 and ADR-022.

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
| `idx_expense_records_category`    | `expense_records`      | `category_id`                               | Historical expenses referencing a category.           |
| `idx_expense_records_subcategory` | `expense_records`      | `subcategory_id`                            | Historical expenses referencing a subcategory.        |
| `idx_expense_records_sheet_row`   | `expense_records`      | `spreadsheet_id`, `sheet_name`, `row_index` | Deterministic row reference for undo.                 |
| `idx_operation_logs_user_created` | `operation_logs`       | `user_id`, `created_at`                     | User audit history.                                   |

### Partial indexes

| Index                             | Table                 | Columns                   | `WHERE` clause                      | Purpose                              |
| --------------------------------- | --------------------- | ------------------------- | ----------------------------------- | ------------------------------------ |
| `idx_conversation_states_expires` | `conversation_states` | `expires_at`              | `expires_at IS NOT NULL`            | Cleanup job for expired states.      |
| `idx_oauth_tokens_expires`        | `oauth_tokens`        | `access_token_expires_at` | `revoked_at IS NULL`                | Proactive refresh detection.         |
| `idx_user_categories_spreadsheet` | `user_categories`     | `spreadsheet_id`          | `is_active = true`                  | Active category lookups.             |
| `idx_user_subcategories_category` | `user_subcategories`  | `category_id`             | `is_active = true`                  | Active children for one category.    |
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
| `user_subcategories`   | `category_id`    | `user_categories`     | `CASCADE`   | Delete configured children when their category is hard-deleted.       |
| `expense_records`      | `user_id`        | `users`               | `CASCADE`   | Remove expenses when a user is deleted.                               |
| `expense_records`      | `spreadsheet_id` | `spreadsheet_configs` | `NO ACTION` | Intentionally preserves expense history if a spreadsheet is unlinked. |
| `expense_records`      | `category_id`    | `user_categories`     | `SET NULL`  | Retain the category snapshot if its vocabulary row is deleted.        |
| `expense_records`      | `subcategory_id` | `user_subcategories`  | `SET NULL`  | Retain the subcategory snapshot if its vocabulary row is deleted.     |
| `operation_logs`       | `user_id`        | `users`               | `CASCADE`   | Remove audit trail when a user is deleted.                            |

## Domain Aggregates

### CategoryVocabulary

Aggregate root that encapsulates the complete category/subcategory hierarchy for one spreadsheet. Category names are unique after normalization across the spreadsheet. Subcategory names are unique only within their parent, so the same normalized child name may exist under different categories.

| Method              | Arguments                                | Behavior                                                                                      |
| ------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `addCategory`       | `name: string`                           | Creates a category with a stable generated UUID after rejecting blank or duplicate names.     |
| `removeCategory`    | `id: string`                             | Removes the category and every child in its active branch.                                    |
| `renameCategory`    | `id: string`, `newName: string`          | Preserves the category UUID and applies the category-level name invariants.                   |
| `getSubcategories`  | `categoryId?: string`                    | Returns immutable copies of every child or only the children of one parent.                   |
| `findSubcategory`   | `categoryId: string`, `name: string`     | Performs an exact normalized lookup isolated to one parent.                                   |
| `addSubcategory`    | `categoryId: string`, `name: string`     | Requires an existing parent and creates a child with a stable generated UUID.                 |
| `renameSubcategory` | `id: string`, `newName: string`          | Preserves the child UUID and parent while enforcing uniqueness within that parent.            |
| `moveSubcategory`   | `id: string`, `targetCategoryId: string` | Preserves the child UUID and name, requires the target parent, and rejects target collisions. |
| `removeSubcategory` | `id: string`                             | Removes only the selected child from the active aggregate.                                    |

`ICategoryVocabularyRepository` loads only active parents and active children attached to those parents. Its `save` operation reads and mutates both tables inside one database transaction: parents are inserted, renamed, or reactivated before children; missing aggregate entries are soft-disabled; moves update the existing child row; and any child failure rolls back the complete hierarchy mutation.

Aggregate-generated UUIDs are supplied explicitly for new category and subcategory rows. When a normalized natural key already exists, reactivation keeps the database row's established primary key instead of rewriting it. Parent IDs are resolved before child persistence, so a child created beneath a reactivated category always references the persisted parent UUID. Repeated saves are idempotent.

## Design Decisions

- **TEXT with CHECK over ENUM.** PostgreSQL `ENUM` types require `ALTER TYPE` to add values. A `CHECK` constraint can be updated with a simple `ALTER TABLE`, simplifying migrations when Release 2 introduces new states or operations.
- **Double validation on `expense_queue.position`.** The limit of 2 pending items is validated in Application logic and enforced by the database `CHECK (position BETWEEN 1 AND 2)` as a safety net.
- **Partial indexes for hot queries.** Indexes with `WHERE` clauses reduce index size and improve read performance for the most frequent access patterns: active categories, non-deleted expenses, and expired conversation states.
- **`expense_records.spreadsheet_id` uses `ON DELETE NO ACTION`.** This is the only non-cascading foreign key. It preserves the internal expense history even if the user unlinks or deletes a spreadsheet configuration, supporting future analytics and audit requirements.
- **AES-256-GCM token storage.** OAuth tokens are encrypted at rest with a per-row IV. The encryption key is a runtime secret; the database contains no plaintext credentials. See ADR-007.
- **Placeholder `access_verified_at` on first creation (Option A).** When `spreadsheet_configs` is first created during HU-4.03 sheet selection, `access_verified_at` is initialized to the current timestamp as a placeholder. The real read/write permission verification is performed later during HU-4.04 and the timestamp is updated to the actual verification time via `updateAccessVerified`. This allows the record to be persisted immediately while keeping the verification step separate.
- **Config replaced on re-onboarding via upsert.** When a user re-onboards (e.g., after an expired OAuth token), `ISpreadsheetConfigRepository.upsertByUserId` transparently replaces the existing row via `ON CONFLICT (user_id) DO UPDATE`, avoiding `uq_user_spreadsheet` violations. The `create` method remains for first-time users only.
- **Optional spreadsheet row reference.** A confirmed spreadsheet write always records its destination sheet; `expense_records.row_index` is nullable only when the provider confirms the write but does not expose a row number. This preserves the successful-save audit while preventing an unverified row reference from being invented.
- **Aggregate-oriented category repository.** `ICategoryVocabularyRepository` provides aggregate-level operations (`findBySpreadsheetId`, `save`) while `IUserCategoryRepository` continues to expose row-level operations (`findActiveBySpreadsheetId`, `upsertMany`, `incrementUsage`). Both interfaces are implemented by separate Drizzle repository classes operating on the same `user_categories` table, keeping the Domain and Application layers clean of ORM details.
- **Linked subcategories use stable references plus immutable snapshots.** `user_subcategories` requires a parent category and scopes normalized-name uniqueness to that parent. Saved expenses keep nullable category/subcategory UUID references for traceability and separate `categoria`/`subcategoria` text snapshots for historical stability. Vocabulary deletion sets references to NULL without rewriting snapshots, and existing rows receive no inferred backfill. See ADR-022.

## Related ADRs

- [ADR-003: Conversational State — FSM Persisted in PostgreSQL](../adr/ADR-003-fsm-postgresql.md) and [ADR-017: Require Confirmation for Delayed Expense Undo](../adr/ADR-017-undo-confirmation-fsm.md) — Define the 15 FSM states stored in `conversation_states`, including `EXPENSE_UNDO_CONFIRMING`.
- [ADR-004: Spreadsheet Integration — Adapter Pattern](../adr/adr.md#adr-004--integración-con-planillas-adapter-pattern) — Motivates `spreadsheet_configs`, `column_mappings`, and dynamic column mapping.
- [ADR-007: Security — OAuth Token Storage with AES-256](../adr/adr.md#adr-007--seguridad-almacenamiento-de-tokens-oauth-con-aes-256) — Describes the encryption strategy for `oauth_tokens`.
- [ADR-008: User Identity — Local Registration with Own userId](../adr/adr.md#adr-008--identidad-de-usuario-registro-local-con-userid-propio) — Explains the `users` / `messaging_identities` split and the internal `user_id` anchor.
- [ADR-022: Store Linked Subcategories with Stable References and Snapshots](../adr/ADR-022-linked-subcategory-hierarchy.md) — Defines the required parent hierarchy, parent-scoped uniqueness, nullable expense references, and immutable snapshots.
