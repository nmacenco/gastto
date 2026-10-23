# Fix duplicate spreadsheet config on re-onboarding + triplicated confirmation message

## Goal

Fix the onboarding bug where a user whose OAuth token expired re-issues onboarding and re-selects a sheet, causing a permanent job failure (`duplicate key value violates unique constraint "uq_user_spreadsheet"`) and the confirmation message "Elegiste la hoja *X*. Ahora vamos a analizar la estructura." being sent 3 times (one per BullMQ retry). Make spreadsheet config persistence idempotent on re-onboarding and remove the retry-induced message duplication.

## Context

When the user re-onboards (token expired -> reconnect -> re-select file + sheet), the user already has a `spreadsheet_configs` row from their previous onboarding. The current `confirmSheet` flow performs a plain `INSERT`, which collides with the per-user unique index `uq_user_spreadsheet`. The exception is thrown **after** the user-facing confirmation message has been sent but **before** the FSM transition to `ONBOARDING_VALIDATING_ACCESS` commits. Because the transition never lands, the `process-message` BullMQ job (configured with `attempts: 3`) re-runs the same handler on each retry, re-sending the message and re-throwing, ultimately failing permanently after 3 attempts.

Key files / artifacts to review:

- `src/application/use-cases/spreadsheet/HandleSheetSelection.ts` - `confirmSheet` (lines 441-486). Ordering is: send message (451-452) -> `spreadsheetConfigRepository.create` INSERT (455) -> `transitionState` (475) -> `triggerAccessValidation` (485).
- `src/domain/ports/repositories.ts` - `ISpreadsheetConfigRepository` (105-109). Only exposes `findByUserId`, `create`, `updateAccessVerified`: no upsert/update path for re-onboarding.
- `src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.ts` - `create` (27-45). Plain `db.insert(...)`, no `.onConflictDoUpdate()`.
- `src/infrastructure/db/schema/index.ts` - `spreadsheetConfigs` table (150-170); unique index `uq_user_spreadsheet` on `user_id` (167).
- `src/interfaces/workers/message.worker.ts` - `processMessageJob` (59-180). No try/catch; ONBOARDING_SHEET branch dispatches to `handleSheetSelection.execute` (167-176). Worker logs permanent failure only (243-251).
- `src/main.ts` - queue `defaultJobOptions` with `attempts: 3` for `process-message` (197-205) and `incoming-message` (207-215).
- `src/application/copies/onboarding.copies.ts` - `sheetSelectedConfirmation` (61-62); NSLocalizedString-style copy source.
- `docs/features/select-sheet.md` - feature doc; Error Handling table (154-168) lacks a re-onboarding / duplicate-config row.
- `docs/architecture/data-model.md` - data model doc; must reflect the upsert-on-reonboarding contract.
- `docs/adr/adr.md` and `docs/adr/template.md` - ADR index + template. A short ADR recording the "spreadsheet config is replaceable per user on re-onboarding, persisted via upsert" decision is needed.

## Phase 1 (vertical slice, single PR)

Make spreadsheet config persistence idempotent on re-onboarding, and stop BullMQ retries from duplicating user-facing messages. After this phase a user can re-onboard any number of times without constraint errors or repeated messages.

### To-do actions

- Add an upsert contract to the `ISpreadsheetConfigRepository` domain port (`src/domain/ports/repositories.ts`).
  - Add `upsertByUserId(config: Omit<SpreadsheetConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<SpreadsheetConfig>`.
  - Keep `create` for back-compat only if other call sites still need it; otherwise replace its consumers. Document the contract change in `docs/features/select-sheet.md` (API Contracts -> ISpreadsheetConfigRepository) and `docs/architecture/data-model.md`.

- Implement `upsertByUserId` in `DrizzleSpreadsheetConfigRepository` (`src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.ts`) using Drizzle `db.insert(...).values(...).onConflictDoUpdate({ target: spreadsheetConfigs.userId, set: { provider, fileId, fileName, sheetName, accessVerifiedAt, updatedAt: new Date() } }).returning()`.
  - Confirm there is no DB migration needed (the unique index `uq_user_spreadsheet` already exists). Generate/migrate only if the on-conflict target name differs; otherwise no migration. Update `docs/architecture/data-model.md`.

- Reorder operations in `HandleSheetSelection.confirmSheet` (`src/application/use-cases/spreadsheet/HandleSheetSelection.ts:441-486`):
  1. `spreadsheetConfigRepository.upsertByUserId({...})` (persist first).
  2. `transitionState.execute({ targetState: 'ONBOARDING_VALIDATING_ACCESS', payload })` (commit FSM transition).
  3. `messagingPort.sendMessage(externalId, message)` (send user-facing confirmation only after the FSM has advanced, so a retry will not re-send on the same starting state).
  4. `triggerAccessValidation(...)` (eager advance, ADR-014; wrapped in isolated try/catch as today).
  - Reordering ensures: if persistence throws, no message leaks; if transition throws on retry, the FSM state has already advanced so the next attempt does not re-enter `confirmSheet`.

- In `HandleSheetSelection.handleSelection`, when the FSM is already in `ONBOARDING_SHEET` and a sheet choice is received but a `spreadsheet_configs` row already exists for the user (re-onboarding), the upsert path is taken transparently; no separate user-facing message is required. Add an explicit code comment? No (per codebase rule no comments unless asked). Instead cover this in the feature doc.

- Wrap `processMessageJob` (`src/interfaces/workers/message.worker.ts:59-180`) in a `try/catch` so a thrown use-case error:
  - is logged via `opts.logger.error` with structured fields (`{ msg, endpoint, code, userId }`),
  - returns normally so BullMQ does not retry (the use case has already produced its own user-facing recovery message for known error paths: reconnect, fileAccessFailed, sheetDiscoveryFailed, invalid selection re-prompt, etc.),
  - OR, for unknown/unexpected errors, sends a single generic failure copy and transitions to a safe state (`IDLE` or `ONBOARDING_START`) before returning, instead of letting BullMQ silently retry side-effectful handlers.

- Review the `process-message` queue `defaultJobOptions` in `src/main.ts:197-205`. Keep `attempts: 3` only if the worker is made idempotent against re-execution; otherwise set `attempts: 1` for `process-message` (keep retries on `incoming-message` which only routes). Document the rationale in the ADR.

- Tests (Vitest). Add/extend the following suites:
  - `DrizzleSpreadsheetConfigRepository` (or its unit-level double): `upsertByUserId` inserts when no row exists; `upsertByUserId` overwrites `provider/fileId/fileName/sheetName/accessVerifiedAt/updatedAt` when a row already exists; `upsertByUserId` preserves `id/createdAt`.
  - `HandleSheetSelection.confirmSheet` (unit, mocks): persistence happens before message send; on re-onboarding (existing config) no error is thrown and the upsert is called with the new `sheetName/fileId/fileName`; FSM transition to `ONBOARDING_VALIDATING_ACCESS` happens; eager validation still invoked.
  - `processMessageJob` worker (unit, mocks): a thrown use-case error is caught, logged with structured fields, and does not propagate to BullMQ (no retry); no duplicate user-facing message is sent on a single job execution.

- Documentation:
  - `docs/features/select-sheet.md`: add re-onboarding behavior to the Flow Sequence (config is replaceable per user via upsert when re-selecting a sheet); add an Error Handling row "User re-onboards and already has a config row -> upsert replaces the existing row; no error surfaced to the user."; update the `ISpreadsheetConfigRepository` contract block to document `upsertByUserId`; update the QA Checklist with a "re-onboarding selection by number -> upsert replaces config" item. Update `docs/features/README.md` index if a new feature doc is created (no new feature doc expected here).
  - `docs/architecture/data-model.md`: note that `spreadsheet_configs` rows are replaced (not duplicated) per user on re-onboarding via upsert on `uq_user_spreadsheet`.
  - New ADR under `docs/adr/2026-07-05-upsert-spreadsheet-config-on-reonboarding.md` from `docs/adr/template.md`: decision (config replaceable per user; persist via upsert; FSM transition before user message; `process-message` worker does not propagate use-case errors to BullMQ retries); rationale; consequences. Update `docs/adr/README.md` index.

- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Run `pnpm test` to verify the test suite passes. Fix failing tests if any (do not add filler tests; mock only at boundaries).
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases complete. All todos checked off.

## Public contracts touched

- Domain port: `ISpreadsheetConfigRepository` -> add `upsertByUserId`.
- Infrastructure repo: `DrizzleSpreadsheetConfigRepository` -> implement `upsertByUserId` via `.onConflictDoUpdate`.
- Application use case: `HandleSheetSelection.confirmSheet` -> reorder + use upsert.
- Worker: `processMessageJob` -> try/catch, no BullMQ retry propagation of use-case errors.
- Queue config: `process-message` `defaultJobOptions` -> attempts policy reviewed (likely `attempts: 1`).
- Copies: no new user-facing copy strictly required for the fix (existing reconnect/error copies remain sufficient).
- Tests: new unit tests for `upsertByUserId`, `confirmSheet` re-onboarding ordering, and `processMessageJob` non-retry behavior.
- Docs: `docs/features/select-sheet.md`, `docs/architecture/data-model.md`, new ADR, related README indexes.