# Implement Pending Expense Queue

## Goal

Implement E1-US-13 using the existing `expense_queue` table and domain port. Rapid expense messages must be stored FIFO, processed one at a time, and coordinated with review, cancellation, timeout, and undo flows without adding an HTTP API.

## Context

- [`src/domain/entities/ConversationState.ts`](../../../src/domain/entities/ConversationState.ts): Defines the FSM and `ExpenseQueueItem` model.
- [`src/domain/ports/repositories.ts`](../../../src/domain/ports/repositories.ts): Defines `IExpenseQueueRepository`; the Drizzle implementation is missing.
- [`src/interfaces/workers/message.worker.ts`](../../../src/interfaces/workers/message.worker.ts): Dispatches FSM messages under a per-user lock and must remain a thin adapter.
- [`docs/architecture/fsm-states.md`](../../../docs/architecture/fsm-states.md), [`docs/architecture/data-model.md`](../../../docs/architecture/data-model.md), and ADR-003, ADR-005, ADR-011, ADR-014, and ADR-017: Define durable FSM state, asynchronous processing, FIFO routing, eager advance, and undo behavior.
- [`docs/features/conversation-state-management.md`](../../../docs/features/conversation-state-management.md), [`docs/features/expense-confirmation.md`](../../../docs/features/expense-confirmation.md), [`docs/features/expense-cancellation.md`](../../../docs/features/expense-cancellation.md), and [`docs/features/undo-last-expense.md`](../../../docs/features/undo-last-expense.md): Define the flows extended by this story.
- [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md): Requires queue overflow negative assertions and FIFO integration coverage.

## Phases

### Phase 1: Queue persistence and admission

**Description:** Make rapid incoming expenses queueable and enforce the two-pending-item limit while preserving the active conversation flow.

- [x] Implement `DrizzleExpenseQueueRepository` for the existing `IExpenseQueueRepository`, with ordered reads and transactional enqueue/dequeue operations.
- [x] Register the repository in dependency construction and expose it only through Application-layer use cases.
- [x] Add `QueuePendingExpense.execute({ userId, rawMessage, channel })`, returning `{ status: 'queued', pendingCount }` or `{ status: 'full', pendingCount: 2 }`.
- [x] In active expense states, classify an additional expense before invoking the queue use case; acknowledge queued expenses normally and return the specified blocking copy when full.
- [x] Preserve the active FSM payload, duplicate-message protection, and the existing per-user Redis lock. Do not add a migration or HTTP endpoint because the queue schema and indexes already exist.
- [x] Add domain, repository, use-case, and worker delegation tests for FIFO admission, overflow, and no active-flow mutation.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Sequential resolution after confirmation and cancellation

**Description:** Advance exactly one queued message through the existing interpretation and review path after a successful save or cancellation.

- [x] Add `AdvancePendingExpense.execute({ userId, chatId, channel, reason })`, where `reason` is `confirmed`, `cancelled`, or `expired`; it dequeues the oldest item and reuses `RegisterExpenseUseCase` plus the existing summary presenter.
- [x] Extend save and cancellation orchestration so the delivery order is the existing save or cancellation outcome, the queue-count notice, and then the next expense summary.
- [x] Retain the queue unchanged while correction or clarification is in progress.
- [x] Send the final registered-expenses copy only after the final queued expense is confirmed and the FSM returns to `IDLE`.
- [x] Add typed copy helpers for queue notice, queue-full rejection, non-financial reminder, expiration advance, and closing summary.
- [x] Test one- and two-item queues, FIFO ordering, capacity release, cancellation, save failure, and message ordering.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Timeout, undo, verification, and documentation

**Description:** Complete cross-flow behavior and prove the complete three-expense journey.

- [x] Make the first review timeout reminder include the pending count; on the second expiry, discard only the active draft and advance the queue.
- [x] Give undo precedence when immediate undo eligibility exists with an active queued review; pause the review context, execute E1-US-11, then resume it after the undo outcome.
- [x] For non-financial messages with a queue, keep the state and queue unchanged and repeat the queue-aware review reminder indefinitely.
- [x] Add structured error logs for queue advance, timeout, and undo failures without exposing provider errors or dropping queue items.
- [x] Add integration coverage for three rapid expenses through `IDLE`, overflow and capacity release, cancellation, repeated non-financial replies, two-stage timeout, and undo resumption.
- [x] Update feature, FSM, and data-model documentation with implemented behavior; update a documentation README index only if a feature document is added or renamed.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete.
