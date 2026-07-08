# Serialize `process-message` per user with a Redis lock

## Goal

Prevent two `process-message` jobs for the same user from running concurrently by introducing a Redis-based per-user lock. This closes the ordering gap left by ADR-011: the thin worker guarantees FIFO enqueueing, but the thick worker's `concurrency: 2` could still process two messages from the same user out of order.

## Context

- `src/interfaces/workers/message.worker.ts`: thick `process-message` worker (`concurrency: 2`). Each job reads the user's FSM state at the start, routes by state, sends replies, and transitions state.
- `src/main.ts`: wires the `process-message` queue with `attempts: 1` because handlers perform side effects (send messages, transition state); re-running would duplicate outbound messages (ADR-015).
- `docs/adr/ADR-011-two-stage-pipeline.md`: two-queue pipeline guarantees FIFO per user at enqueue time, but explicitly notes the thick worker may later process same-user jobs concurrently.
- `docs/features/incoming-message-routing.md`: describes the rapid-message scenario and the FIFO guarantee.
- Existing Redis adapter pattern: `src/infrastructure/redis/RedisMappingCorrectionStateRepository.ts`.

Because `process-message` jobs read the FSM state before any state transition, two concurrent jobs from the same user can both observe the same stale state (for example `IDLE`), produce replies independently, and overwrite each other's transitions. The fix is to serialize the critical section per user while keeping cross-user concurrency.

## Decision

Use a **Redis mutex per `userId`** inside `processMessageJob`:

- Acquire the lock before reading the conversation state.
- Release the lock in a `finally` block.
- If the lock is already held, throw a dedicated `UserAlreadyProcessingError`.
- Catch that error separately in the worker and rethrow it so BullMQ retries the job.
- Configure the `process-message` queue with a **custom backoff strategy** that retries only `UserAlreadyProcessingError` with a short exponential backoff, and returns `-1` for every other error so side-effectful failures are not retried.

This preserves the existing `attempts: 1` safety for business errors while allowing multiple attempts only for transient lock contention.

## Public contracts

### New

- `IUserProcessingLock` (application port):
  - `acquire(userId: string, ttlMs: number): Promise<boolean>`
  - `release(userId: string): Promise<void>`
- `RedisUserProcessingLock` (infrastructure adapter): implements `IUserProcessingLock` using Redis `SET NX PX` and `DEL`.
- `UserAlreadyProcessingError` (domain error): identifies lock contention so the worker can rethrow it for BullMQ retry.

### Modified

- `MessageWorkerDeps`: add `userProcessingLock: IUserProcessingLock`.
- `processMessageJob`: acquire/release lock around routing; rethrow `UserAlreadyProcessingError`.
- `process-message` queue config in `src/main.ts`: add `backoff: { type: 'custom' }` and a custom strategy that retries only `UserAlreadyProcessingError`.

### Tests

- New `src/infrastructure/redis/RedisUserProcessingLock.spec.ts`:
  - acquire returns `true` and sets a key with TTL.
  - second acquire for the same user returns `false`.
  - release deletes the key.
  - after release, acquire returns `true` again.
- Update `src/interfaces/workers/message.worker.spec.ts`:
  - pass `userProcessingLock` through deps.
  - when lock is acquired, processing proceeds normally.
  - when lock is not acquired, the worker rethrows (no side effects, no fallback message).
  - lock is released even when routing throws.

### Documentation

- Update `docs/adr/ADR-011-two-stage-pipeline.md`: state that per-user serialization is now enforced in the thick worker via Redis lock.
- Update `docs/features/incoming-message-routing.md`: document the per-user lock, the custom retry behavior, and the fact that different users still process concurrently.

## Phase 1: Lock port/adapter and worker integration

- [x] Create `src/domain/errors/UserAlreadyProcessingError.ts`.
- [x] Define `IUserProcessingLock` in `src/application/ports/UserProcessingLock.ts`.
- [x] Implement `RedisUserProcessingLock` in `src/infrastructure/redis/RedisUserProcessingLock.ts`.
- [x] Add `userProcessingLock: IUserProcessingLock` to `MessageWorkerDeps` in `src/interfaces/workers/message.worker.ts`.
- [x] Update `processMessageJob` to:
  - acquire the lock before reading state,
  - release it in a `finally` block,
  - rethrow `UserAlreadyProcessingError` without sending a fallback message.
- [x] Wire `RedisUserProcessingLock` into `createMessageWorker` call in `src/main.ts`.
- [x] Add unit tests for `RedisUserProcessingLock`.
- [x] Update `message.worker.spec.ts` for lock acquire/release paths.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.

## Phase 2: Contention retry policy and documentation

- [x] Update the `process-message` queue config in `src/main.ts`:
  - keep `attempts: 1` semantics for non-lock errors by using `backoff: { type: 'custom' }`,
  - register a custom backoff strategy that returns a delay for `UserAlreadyProcessingError` and `-1` for everything else.
- [x] Add race-condition tests in `message.worker.spec.ts`:
  - simulate a held lock: job defers (rethrows) without side effects,
  - simulate lock released after a delay: subsequent job proceeds.
- [x] Add a test or assertion that lock acquisition happens before any use-case side effect.
- [x] Update `docs/adr/ADR-011-two-stage-pipeline.md` to reflect the new per-user serialization guarantee.
- [x] Update `docs/features/incoming-message-routing.md` to document the lock behavior and retry semantics.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.

## Next step

All phases complete. Ready to commit changes.
