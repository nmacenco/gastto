# Goal

Write integration tests for the 5 Gherkin conversation-state scenarios against a real PostgreSQL database, and update the project documentation to reflect the implemented FSM behavior.

# Context

- `AGENTS.md`: architecture, DB conventions (schema-first, transactions, immutable migrations), testing rules (mock only at boundaries), lint/typecheck gates, documentation sync rules.
- `docs/plans/plan-conventions.md`: plan structure and writing style.
- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.04-manage-conversation-state-per-user/tasks/T-0.04-06.md`: integration tests task.
- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.04-manage-conversation-state-per-user/tasks/T-0.04-07.md`: documentation update task.
- Existing use cases under `src/application/use-cases/conversation/`:
  - `GetConversationState.ts` - read current state.
  - `TransitionConversationState.ts` - validate and execute FSM transitions.
  - `HandleStartCommand.ts` - handle `/start`, create state if missing.
  - `RecoverCorruptedState.ts` - detect invalid state, log anomaly, reset to `IDLE`.
  - `HandleExpiredSessions.ts` - find expired states, transition to `IDLE`, notify user.
- Existing repository implementations under `src/infrastructure/db/repositories/`:
  - `DrizzleConversationStateRepository.ts` - concrete `IConversationStateRepository`.
  - `DrizzleUserRepository.ts` - includes `findMessagingIdentitiesByUserId`.
  - `DrizzleOperationLogRepository.ts` - logs anomalies.
- `src/infrastructure/db/schema/index.ts`: Drizzle schema with `conversation_states`, `users`, `messaging_identities`, `operation_logs`.
- `src/infrastructure/db/migrations/`: existing migration files (0000, 0001).
- `vitest.config.ts`: Vitest configuration with `environment: 'node'`; default glob includes `**/*.spec.ts`.
- `package.json`: `testcontainers` is installed in `devDependencies` but never used.
- All existing `*.spec.ts` files are unit tests with mocked repositories. No integration test infrastructure exists yet.

# Phases

## Phase 1: Integration test infrastructure

**Description:** Bootstrap a real PostgreSQL test database using `testcontainers`, add shared helpers for connection, migration, and seeding, and verify everything with a basic connectivity test.

- [x] Install `@testcontainers/postgresql` as a dev dependency if `PostgreSqlContainer` is not exported from the base `testcontainers` package.
- [x] Create `tests/integration/helpers/db-container.ts` that starts a `PostgreSqlContainer`, exposes a `getConnectionString()` helper, and tears down the container after the test suite.
- [x] Create `tests/integration/helpers/migrate.ts` that runs the existing Drizzle migrations (`src/infrastructure/db/migrations/`) against the test database before tests execute.
- [x] Create `tests/integration/helpers/fixtures.ts` with seed helpers:
  - `createUser(db, overrides?)` - inserts a `users` row.
  - `createMessagingIdentity(db, overrides?)` - inserts a `messaging_identities` row linked to a user.
  - `createConversationState(db, overrides?)` - inserts a `conversation_states` row.
- [x] Create `tests/integration/conversation-state/connection.spec.ts` with a single test that seeds a user, inserts a conversation state, reads it back via `DrizzleConversationStateRepository`, and asserts the mapped entity. This proves the container, migrations, and Drizzle driver work end-to-end.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 2: Write integration tests for all 5 Gherkin scenarios

**Description:** Exercise the full state management flow through real repositories. Mock `MessagingOutputPort` to assert on sent messages without hitting Telegram. Use fixture helpers and fake timers where needed.

- [x] Create `tests/integration/conversation-state/ConversationState.integration.spec.ts`.
- [x] **Scenario 1 - New user initialization:** Simulate a `/start` command via `HandleStartCommand`. Assert that `DrizzleConversationStateRepository.findByUserId` returns a state with `currentState = 'IDLE'` (implemented behavior). Note: the task acceptance criteria references `ONBOARDING_START`; the test should document the actual `IDLE` creation behavior and leave a TODO comment if an onboarding transition is pending.
- [x] **Scenario 2 - Valid state transition:** Create a user with `IDLE` state. Execute `TransitionConversationState` to `EXPENSE_RECEIVING` with a payload and `expiresAt`. Assert the new state, payload, and expiration are persisted. Then read it back via `GetConversationState` and assert the same values.
- [x] **Scenario 3 - Session persistence across simulated restarts:** Create a user with state `EXPENSE_REVIEW` and a non-null payload. Close the DB connection, open a fresh one (simulate restart), read the state via `GetConversationState`, and assert `currentState` and payload are intact.
- [x] **Scenario 4 - Corrupted state recovery:** Manually insert a row with an invalid `current_state` value directly into the table (bypassing the CHECK constraint or use a raw SQL update if the CHECK blocks it; otherwise mock at the boundary by feeding the invalid string to `RecoverCorruptedState`). Execute `RecoverCorruptedState`. Assert an `operation_logs` row exists with `errorType = 'CORRUPTED_STATE'`, and assert the state is reset to `IDLE`.
- [x] **Scenario 5 - Session timeout:** Create a user with state `EXPENSE_REVIEW` and `expiresAt` in the past. Execute `HandleExpiredSessions` with a mocked `MessagingOutputPort`. Assert `transitionState` moves the user to `IDLE`, and assert the messaging port received the timeout prompt: `"Tu sesion expiro. Queres continuar o empezar de nuevo?"`.
- [x] Run all tests with `pnpm test`. Ensure all 5 scenarios pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 3: Update documentation

**Description:** Sync the canonical docs with the implemented behavior. Verify the data model reference and create the missing feature documentation.

- [x] Review `docs/architecture/data-model.md` for completeness on `conversation_states`:
  - Verify all columns, indexes (`idx_conversation_states_expires`, `idx_conversation_states_current`), and the FK to `users` are documented.
  - If anything is missing or inaccurate, update it.
- [x] Create `docs/features/conversation-state-management.md` following `docs/features/TEMPLATE.md`. It must cover:
  - FSM state list (13 states from `FSM_STATES`) and transition map (`FSM_TRANSITIONS`).
  - Persistence mechanism: Drizzle ORM + PostgreSQL via `conversation_states`.
  - Timeout behavior: `expiresAt` field, `HandleExpiredSessions` cleanup, user prompt copy.
  - Corrupted-state recovery: `RecoverCorruptedState` anomaly logging + reset to `IDLE`.
  - Clean Architecture boundary: route/worker delegates to use cases; use cases own logic and call repository ports.
- [x] Add a TODO reference in the feature doc if any behavior (e.g., full onboarding FSM transitions) is pending a later HU.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

# Next step

All phases completed. No further action required for this plan.
