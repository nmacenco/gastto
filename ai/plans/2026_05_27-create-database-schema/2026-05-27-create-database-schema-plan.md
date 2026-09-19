Plan: Create and synchronize the MVP database schema

## Goal

Audit, synchronize, and migrate the Drizzle ORM schema to match the canonical SQL design, generate Drizzle migrations, apply them locally, and document the complete data model.

## Context

- The Drizzle schema lives in `src/infrastructure/db/schema/index.ts`. It already defines all 9 MVP tables but is missing some CHECK constraints and partial index WHERE clauses present in the canonical `script.sql`.
- Domain entities and repository ports are already defined in `src/domain/entities/` and `src/domain/ports/repositories.ts`.
- Only `DrizzleUserRepository.ts` exists under `src/infrastructure/db/repositories/`.
- `docs/architecture/data-model.md` is empty (only a TODO).
- No Drizzle migrations have been generated yet (`drizzle/` directory does not exist).
- Relevant docs:
  - `docs/adr/adr.md` — ADR-003 (FSM), ADR-004 (Spreadsheet adapter), ADR-007 (AES-256 tokens), ADR-008 (User identity).
  - `docs/plans/plan-conventions.md` — Plan structure conventions.
  - `AGENTS.md` — DB conventions, migration rules, documentation sync, and ship check gates.
- The canonical SQL reference is `script.sql` (and `detalle-completo-db.md` which describes the same schema). **Both were deleted after consolidation.**

## Phases

### Phase 1: Schema synchronization

Update the Drizzle schema to match the canonical design, adding missing constraints and partial index filters.

**To-do actions:**

- [x] Add `CHECK` constraint on `conversation_states.current_state` restricting to the 13 valid FSM states.
- [x] Convert `idx_conversation_states_expires` to a partial index with `.where(sql\`is not null\`)`on`expires_at`.
- [x] Convert `idx_expense_records_user_latest` to a partial index with `.where(sql\`is_deleted = false\`)`.
- [x] Convert `idx_expense_records_user_fecha` to a partial index with `.where(sql\`is_deleted = false\`)`.
- [x] Convert `idx_operation_logs_failures` to a partial index with `.where(sql\`operation = 'EXPENSE_SAVE_FAILED'\`)`.
- [x] Convert `idx_user_categories_spreadsheet` to a partial index with `.where(sql\`is_active = true\`)`.
- [x] Rename the Drizzle schema field from `Gastto_field` to `gastto_field` (lowercase) in `column_mappings`, ensuring it stays consistent with the domain entity `GasttoField` and the rest of the codebase.
- [x] Add `CHECK` constraint on `expense_records.monto >= 0`.
- [x] Add `CHECK` constraint on `expense_records.moneda` restricting to the 6 valid currencies.
- [x] Add `CHECK` constraint on `expense_records.categoria_confidence` restricting to `'alta' | 'baja' | 'nula' | null`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Public contracts modified:**

- Database schema: `conversation_states` (CHECK on `current_state`, partial index on `expires_at`).
- Database schema: `expense_records` (partial indexes on `user_latest` and `user_fecha`, CHECKs on `monto`, `moneda`, `categoria_confidence`).
- Database schema: `operation_logs` (partial index on failures).
- Database schema: `user_categories` (partial index on `is_active`).
- Database schema: `column_mappings` (renamed field `gastto_field`).

### Phase 2: Migration generation and local application

Generate Drizzle migrations from the synchronized schema and apply them to the local database.

**To-do actions:**

- [x] Run `pnpm db:generate` to produce the initial migration SQL under `src/infrastructure/db/migrations/`.
- [x] Review the generated migration SQL against `script.sql` to confirm tables, constraints, indexes, and foreign keys match.
- [x] Run `pnpm db:migrate` to apply the migration to the Supabase database.
- [x] Verify that all 10 tables (`users`, `messaging_identities`, `conversation_states`, `expense_queue`, `oauth_tokens`, `spreadsheet_configs`, `column_mappings`, `user_categories`, `expense_records`, `operation_logs`) were created correctly.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Public contracts created:**

- Drizzle migration files under `src/infrastructure/db/migrations/`.
- Follow-up migration `0001_add_check_constraints.sql` to add CHECK constraints omitted by drizzle-kit v0.22.8.

### Phase 3: Data model documentation

Complete `docs/architecture/data-model.md` so it reflects the implemented schema.

**To-do actions:**

- [x] Document all 10 tables with columns, types, constraints, and descriptions.
- [x] Document all indexes (including partial indexes and their WHERE clauses).
- [x] Document all foreign keys and `ON DELETE` behaviors.
- [x] Document the relationship graph (users as the anchor table, one-to-many relationships).
- [x] Reference relevant ADRs (003, 004, 007, 008) where applicable.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

**Public contracts created:**

- Documentation: `docs/architecture/data-model.md`.

## Status

All phases completed. The MVP database schema is fully synchronized, migrated, and documented.

## Post-completion notes

- The initial drizzle-kit migration (`0000_abandoned_the_leader`) did not include CHECK constraints. A follow-up migration (`0001_add_check_constraints`) was created manually to add all 12 CHECK constraints. This is a known limitation of drizzle-kit v0.22.8 with the `pgTable` + `check()` API.
- The canonical reference files (`script.sql` and `detalle-completo-db.md`) were deleted after their contents were consolidated into the Drizzle schema, migrations, and `docs/architecture/data-model.md`.
