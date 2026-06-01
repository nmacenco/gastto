# Wire state management into message pipeline & implement session timeout worker

## Goal

Remove direct repository access from the message processing pipeline, ensure `/start` initializes or verifies the user's conversation state, and introduce a periodic BullMQ worker that finds expired conversation states, transitions them to `IDLE`, and notifies the user.

## Context

- **Workers**: `src/interfaces/workers/message.worker.ts` currently calls `opts.conversationRepo.findByUserId` directly (line 33). It already delegates transitions to `TransitionConversationState` and recovery to `RecoverCorruptedState`. `incomingMessage.worker.ts` follows a thin-worker pattern with BullMQ + `ioredis`.
- **Routes**: `src/interfaces/http/routes/telegram.webhook.ts` short-circuits `/start` to `HandleStartCommand` but never verifies conversation state.
- **Composition root**: `src/main.ts` manually wires all dependencies via constructor injection.
- **Use cases**: `TransitionConversationState` and `RecoverCorruptedState` exist in `src/application/use-cases/conversation/`. `HandleStartCommand` only sends a welcome message.
- **Repository port**: `IConversationStateRepository` has `findExpired()` and `transition()`; `IUserRepository` does not expose a lookup from `userId` back to messaging identities.
- **Tests**: `HandleStartCommand.spec.ts`, `telegram.webhook.spec.ts`, `TransitionConversationState.spec.ts`, and `RecoverCorruptedState.spec.ts` exist. No unit tests exist for `message.worker.ts`.
- **Relevant docs**: `docs/plans/plan-conventions.md`, `AGENTS.md` (architecture, DI, error logging, DB conventions).

## Public contracts

### Application services / Use cases

- `GetConversationState.execute(input: { userId: string }): Promise<ConversationState | null>` — **new**
- `HandleStartCommand.execute(input: { userId: string; chatId: string; username?: string }): Promise<HandleStartCommandOutput>` — **modified** (adds `IConversationStateRepository` dependency; input gains `userId`)
- `HandleExpiredSessions.execute(): Promise<void>` — **new** (finds expired states, transitions to `IDLE`, sends notification)
- `IUserRepository.findMessagingIdentitiesByUserId(userId: string): Promise<MessagingIdentity[]>` — **new method on port**

### Test suites

- `HandleStartCommand.spec.ts` — **modified** (mock repository, add state-verification test cases)
- `telegram.webhook.spec.ts` — **modified** (inject `resolveIdentity`, assert `/start` delegates correctly)
- `GetConversationState.spec.ts` — **new**
- `message.worker.spec.ts` — **new** (mocks `getConversationState`, `transitionState`, `recoverCorruptedState`, `messagingAdapters`)
- `HandleExpiredSessions.spec.ts` — **new**
- `sessionTimeout.worker.spec.ts` — **new**
- `DrizzleUserRepository.spec.ts` — **modified** (add `findMessagingIdentitiesByUserId` tests)

### Text copies

- Session timeout message: `"Tu sesion expiro. Queres continuar o empezar de nuevo?"` (shown to end users)

## Phases

### Phase 1: Update `/start` flow to verify conversation state

_Visible change: `/start` now guarantees the user has a valid conversation state._

- [x] Add `IConversationStateRepository` to `HandleStartCommand` constructor.
- [x] Extend `HandleStartCommandInput` with `userId`.
- [x] In `execute`: after sending the welcome message, call `conversationRepo.findByUserId`. If missing, call `conversationRepo.create`.
- [x] Update `telegram.webhook.ts` to resolve user identity (via `ResolveUserIdentityUseCase`) before calling `HandleStartCommand` on `/start`. Add `resolveIdentity` to `TelegramWebhookHandlerDeps`.
- [x] Update `main.ts` to wire `resolveIdentity` into the webhook deps.
- [x] Update `HandleStartCommand.spec.ts` with repository mocks and state-verification test cases.
- [x] Update `telegram.webhook.spec.ts` to inject the new dependency and assert the `/start` identity-resolution flow.
- [x] Run `pnpm lint && pnpm typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Refactor `message.worker.ts` to use application use cases only

_Visible change: `message.worker.ts` no longer depends on `IConversationStateRepository`; the Clean Architecture boundary is restored._

- [x] Create `GetConversationState` use case (`src/application/use-cases/conversation/GetConversationState.ts`) that wraps `conversationRepo.findByUserId`.
- [x] Update `message.worker.ts` factory opts: remove `conversationRepo`, add `getConversationState`.
- [x] Replace the direct `opts.conversationRepo.findByUserId(userId)` call with `opts.getConversationState.execute({ userId })`.
- [x] Update `main.ts`: instantiate `GetConversationState`, pass it to `createMessageWorker` instead of `conversationRepo`.
- [x] Create `GetConversationState.spec.ts`.
- [x] Create `message.worker.spec.ts` following the `incomingMessage.worker.spec.ts` pattern (mock `bullmq.Worker`, mock dependencies, test FSM routing branches).
- [x] Run `pnpm lint && pnpm typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Implement session timeout worker

_Visible change: a background worker periodically handles expired sessions and notifies users._

- [x] Add `findMessagingIdentitiesByUserId(userId: string): Promise<MessagingIdentity[]>` to `IUserRepository` and implement it in `DrizzleUserRepository` (query `messagingIdentities` by `userId`, leveraging existing `idx_messaging_identities_user` index).
- [x] Create `HandleExpiredSessions` use case (`src/application/use-cases/conversation/HandleExpiredSessions.ts`):
  - Call `conversationRepo.findExpired()`.
  - For each expired state: transition to `IDLE` via `TransitionConversationState`, look up identities via `IUserRepository`, send timeout message via `MessagingOutputPort`.
  - Wrap per-user processing in `try/catch` with structured `console.error` so one failure does not abort the batch.
- [x] Create `src/interfaces/workers/sessionTimeout.worker.ts`:
  - Factory `createSessionTimeoutWorker(opts)` returning a `bullmq.Worker`.
  - The worker processes a repeatable `"session-timeout"` job (every 60 seconds) and delegates to `HandleExpiredSessions.execute()`.
  - Include structured error logging on `worker.on('failed', ...)`.
- [x] In `main.ts`:
  - Create the `session-timeout` `Queue` with `repeat: { every: 60000 }`.
  - Instantiate `HandleExpiredSessions`.
  - Create the worker via `createSessionTimeoutWorker`.
  - Wrap queue/worker creation in `try/catch` so failure does not block server startup.
- [x] Create `HandleExpiredSessions.spec.ts` (mock repository, transition use case, messaging port).
- [x] Create `sessionTimeout.worker.spec.ts` (mock `bullmq.Worker`, mock use case, test cron semantics and error logging).
- [x] Update `DrizzleUserRepository.spec.ts` with tests for `findMessagingIdentitiesByUserId`.
- [x] Run `pnpm lint && pnpm typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases completed. Suggest the user export the conversation and store it as a `.md` file alongside the plan, e.g. `ai/plans/2026_05_30-wire_state_management_and_session_timeout/2026_05_30-wire_state_management_and_session_timeout-conversation.md`.
