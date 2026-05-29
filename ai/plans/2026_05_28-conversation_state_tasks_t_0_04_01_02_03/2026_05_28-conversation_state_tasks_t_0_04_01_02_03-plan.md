# Goal

Implement the three conversation state management tasks for the MVP conversational infrastructure: the Drizzle repository (T-0.04-01), the state transition use case (T-0.04-02), and the corrupted state recovery use case (T-0.04-03).

# Context

- `AGENTS.md`: architecture, DB conventions (transactions, schema-first, immutable migrations), test rules.
- `docs/plans/plan-conventions.md`: plan structure.
- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.04-manage-conversation-state-per-user/tasks/T-0.04-01.md`
- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.04-manage-conversation-state-per-user/tasks/T-0.04-02.md`
- `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.04-manage-conversation-state-per-user/tasks/T-0.04-03.md`
- `src/infrastructure/db/schema/index.ts`: `conversationStates` table already defined.
- `src/domain/ports/repositories.ts`: `IConversationStateRepository` and `IOperationLogRepository` interfaces.
- `src/domain/entities/ConversationState.ts`: `FSM_STATES`, `FSM_TRANSITIONS`, `canTransition`, `ConversationState`.
- `src/infrastructure/db/repositories/DrizzleUserRepository.ts`: reference style for Drizzle repository implementation.
- `src/interfaces/workers/message.worker.ts`: currently calls `conversationRepo.transition` directly and has a manual corrupted-state reset in the `default` switch case.
- `src/main.ts`: composition root where `conversationRepo` is injected as `null` with a `@ts-expect-error`.
- `src/application/ports/output/messaging.port.ts`: `MessagingOutputPort` for sending messages.
- `src/domain/errors/DomainValidationError.ts`: existing domain error pattern.

# Phases

## Phase 1: Implement DrizzleConversationStateRepository and wire it

**Description:** Build the concrete repository that persists and queries `conversation_states` rows. Add integration tests. Register it in `main.ts` so the null placeholder is removed and the system can resolve conversation states at runtime.

- [x] Create `src/infrastructure/db/repositories/DrizzleConversationStateRepository.ts` implementing `IConversationStateRepository`.
- [x] Implement `findByUserId`: query `conversationStates` by `userId` and map to `ConversationState` domain entity.
- [x] Implement `create`: insert a new row with `currentState = 'IDLE'`, `statePayload = null`, `expiresAt = null`.
- [x] Implement `transition`: wrap update in `db.transaction(...)`, set `currentState`, `statePayload`, `expiresAt`, and `updatedAt = new Date()`, returning the mapped entity.
- [x] Implement `findExpired`: query rows where `expiresAt <= now()`.
- [x] Add integration test file `src/infrastructure/db/repositories/DrizzleConversationStateRepository.spec.ts` covering all four methods.
- [x] Wire the repository into `src/main.ts`, replacing the `null` / `@ts-expect-error` injection for `conversationRepo`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 2: Implement TransitionConversationState use case and migrate worker transitions

**Description:** Encapsulate FSM transition validation inside an application use case. Stop letting the worker call `conversationRepo.transition` directly.

- [x] Create `src/domain/errors/InvalidStateTransitionError.ts` extending `Error` with a typed name.
- [x] Create `src/application/use-cases/conversation/TransitionConversationState.ts` accepting `userId`, `targetState`, `payload`, and optional `expiresAt`.
- [x] Inside the use case: fetch current state via repository; validate with `canTransition(from, to)`; throw `InvalidStateTransitionError` if invalid; delegate atomic update to repository; return updated `ConversationState`.
- [x] Create `src/application/use-cases/conversation/TransitionConversationState.spec.ts` with unit tests for valid transitions, invalid transitions, and missing current state.
- [x] Refactor `src/interfaces/workers/message.worker.ts`: replace direct `opts.conversationRepo.transition(...)` calls with delegation to the new use case.
- [x] Register `TransitionConversationState` in `src/main.ts` and inject it into the worker options.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 3: Implement RecoverCorruptedState use case and finalize worker delegation

**Description:** Extract the corrupted-state recovery logic from the worker's `default` switch case into a dedicated use case that logs the anomaly and returns a recovery payload.

- [x] Create `src/application/use-cases/conversation/RecoverCorruptedState.ts` accepting `userId` and `observedState`.
- [x] Validate `observedState` against `FSM_STATES`. If invalid: create an `operation_logs` entry via `IOperationLogRepository` with `errorType: 'CORRUPTED_STATE'`; transition user to `IDLE` with null payload via `IConversationStateRepository`; return a recovery message DTO (not send directly).
- [x] Create `src/application/use-cases/conversation/RecoverCorruptedState.spec.ts` with unit tests for corrupted detection, log creation, idle reset, and recovery DTO output.
- [x] Refactor `src/interfaces/workers/message.worker.ts`: replace the `default` case inline recovery logic with a call to `RecoverCorruptedState`, then send the returned recovery message via `MessagingOutputPort`.
- [x] Register `RecoverCorruptedState` in `src/main.ts` and inject it into the worker options.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

# Next step

All phases completed. The plan is fully implemented.
