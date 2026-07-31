# Plan: Interpreted expense summary for review (E1-US-06)

## Goal

Implement the interpreted expense summary review flow for Telegram so that, after the system interprets an expense message, it presents a structured summary with confirm/correct/cancel options, low-confidence visual markers, a "today" default date, high-amount warnings, and a two-stage timeout (one reminder after 10 minutes, then auto-cancel after another 10 minutes).

## Context

- User story: `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-06-interpreted-expense-summary-for-review/E1-US-06 — Interpreted expense summary for review.md`
- Task breakdown: `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-06-interpreted-expense-summary-for-review/tasks/`
- `RegisterExpenseUseCase.interpret()` already transitions to `EXPENSE_REVIEW` with a 10-minute TTL and builds `ExpenseReviewPayload` (`src/application/use-cases/expense/RegisterExpense.ts`).
- `message.worker.ts` currently formats the summary inline using `expenseCopies.expenseSummary()` and sends it as plain text (`src/interfaces/workers/message.worker.ts`).
- `HandleExpiredSessions` resets expired states to `IDLE` with a generic message, but does not implement the review-specific reminder-then-cancel flow (`src/application/use-cases/conversation/HandleExpiredSessions.ts`).
- `TelegramMessengerAdapter` only supports plain text messages; inline keyboards and callback queries are not yet supported (`src/infrastructure/adapters/telegram/TelegramMessengerAdapter.ts`).
- The project uses Clean Architecture: application ports live in `src/application/ports/output/`, use cases in `src/application/use-cases/`, and Telegram adapters in `src/infrastructure/adapters/telegram/`.
- The "Correct" action will be a stub that transitions to a correction sub-dialog, because E1-US-07 (field correction) is not implemented yet.

## Phases

### Phase 1 — Core summary presentation

_Implements T-E1-US-06-01, T-E1-US-06-02 and the first usable slice of T-E1-US-06-05. This phase produces a visible, testable summary message in Telegram._

- [x] Create `src/application/dtos/expense-summary.dto.ts` with the `ExpenseSummary` DTO:
  - `concept: string`
  - `amount: number`
  - `currency: string`
  - `category: string`
  - `date: string`
  - `categoryConfidence: 'alta' | 'baja' | 'nula'`
  - `categoryStatus: 'confirmed' | 'ambiguous' | 'fallback' | 'none'`
  - `actions: { confirm: true; correct: true; cancel: true }`
  - `isHighAmount: boolean` and `requiresExplicitConfirmation: boolean` (initially always `false`).
- [x] Create `src/application/ports/output/expense-summary.presenter.ts` with the `ExpenseSummaryPresenter` output port:
  - `presentSummary(summary: ExpenseSummary): Promise<void>`
  - `showTimeoutWarning(): Promise<void>`
  - `notifyCancellation(): Promise<void>`
  - `requestHighAmountConfirmation(summary: ExpenseSummary): Promise<void>`
- [x] Implement `src/application/use-cases/expense/GenerateExpenseSummaryUseCase.ts`:
  - Accepts the existing `ExpenseReviewPayload` plus a channel-agnostic presenter.
  - Always builds the five-field summary.
  - Defaults the date to "today" when the input has no date.
  - Preserves `categoryConfidence` and `categoryStatus` so the presenter can mark low-confidence categories.
  - Delegates rendering to the injected presenter.
- [x] Implement `src/infrastructure/adapters/telegram/TelegramExpenseSummaryPresenter.ts`:
  - Implements `ExpenseSummaryPresenter`.
  - Formats the summary as a Telegram markdown message.
  - Shows low-confidence markers (`(¿correcto?)` for ambiguous categories, `(sugerida)` for fallback categories) and action instructions.
  - In this phase the actions are described as text ("Responde _sí_, _corregir campo: valor_, o _cancelar_").
- [x] Wire `GenerateExpenseSummaryUseCase` into `src/interfaces/workers/message.worker.ts`:
  - Replace the inline `formatExpenseSummary()` helper for the `ready_for_review` path.
  - The worker delegates to the use case instead of calling `expenseCopies.expenseSummary()` directly.
- [x] Register the new presenter in `src/bootstrap/buildDependencies.ts` and inject it into `message.worker.ts` via `MessageWorkerDeps`.
- [x] Add unit tests for `GenerateExpenseSummaryUseCase` in `src/application/use-cases/expense/GenerateExpenseSummaryUseCase.spec.ts`:
  - Happy path with all five fields.
  - Missing date defaults to "today".
  - Low-confidence category values are preserved.
  - Use case calls the presenter and has no platform-specific dependencies.
- [x] Create the feature documentation `docs/features/expense-summary-review.md` following `docs/features/TEMPLATE.md`, and update `docs/features/README.md`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2 — High-amount warning and timeout/reminder/auto-cancel

_Implements T-E1-US-06-03 and T-E1-US-06-04. This phase adds safety around unusually high amounts and the exact timeout behavior described in the user story._

- [x] Add `findAverageAmountByUserId(userId: string): Promise<number | null>` to `IExpenseRecordRepository` in `src/domain/ports/repositories.ts` and implement it in `src/infrastructure/db/repositories/DrizzleExpenseRecordRepository.ts`.
- [x] Extend `ExpenseSummary` DTO with `isHighAmount: boolean` and `requiresExplicitConfirmation: boolean`.
- [x] Extend `GenerateExpenseSummaryUseCase` to detect high amounts:
  - Query the user's historical average expense amount.
  - When the amount exceeds the configured multiplier of the average, set `isHighAmount = true` and `requiresExplicitConfirmation = true`.
  - When no historical data exists, pass through without warning.
  - Make the multiplier configurable through `HIGH_AMOUNT_THRESHOLD_MULTIPLIER`.
- [x] Update `TelegramExpenseSummaryPresenter` to render the warning indicator (`⚠️ Monto inusualmente alto`) when `isHighAmount` is true and to request explicit confirmation.
- [x] Extend the `EXPENSE_REVIEW` state payload to track timeout state:
  - Add `reminderSent: boolean` to the payload persisted in `conversation_states.state_payload`.
- [x] Update `src/application/use-cases/conversation/HandleExpiredSessions.ts`:
  - For expired `EXPENSE_REVIEW` states with `reminderSent === false`: call `presenter.showTimeoutWarning()`, set `reminderSent: true`, extend `expiresAt` by `EXPENSE_REVIEW_REMINDER_TIMEOUT_MINUTES`.
  - For expired `EXPENSE_REVIEW` states with `reminderSent === true`: transition to `IDLE`, call `presenter.notifyCancellation()`.
  - Keep the existing generic message for all other expired states.
- [x] Add configurable timeout duration constants (`EXPENSE_REVIEW_TIMEOUT_MINUTES` and `EXPENSE_REVIEW_REMINDER_TIMEOUT_MINUTES`) to `src/config/env.schema.ts`.
- [x] Add unit tests:
  - High-amount detection when amount is above the threshold.
  - No warning when there is no historical data.
  - Timeout flow: first expiry sends the reminder and extends TTL; second expiry cancels and transitions to `IDLE`.
- [x] Update `src/application/copies/expense.copies.ts` with new copies for the high-amount warning, the reminder message, and the cancellation notice.
- [x] Update `docs/features/expense-summary-review.md` with the high-amount and timeout behavior.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3 — Inline action buttons and callback resolution

_Implements T-E1-US-06-06 and the remainder of T-E1-US-06-05, plus T-E1-US-06-07. This phase upgrades the Telegram experience from text replies to inline buttons._

- [x] Extend `src/infrastructure/adapters/telegram/TelegramPayloadParser.ts` to recognize Telegram `callback_query` updates and produce a new `CALLBACK` message type (or extend the existing payload contract) with parsed action data.
- [x] Extend `src/domain/ports/messaging.ts` `NormalizedPayload` and `src/application/ports/IncomingMessageJob.ts` `IncomingMessageJobData` to carry callback data:
  - `messageType: 'CALLBACK'`
  - `callbackData: { action: 'confirm' | 'correct' | 'cancel'; field?: string }`
- [x] Extend the Telegram messaging adapter to support inline keyboards:
  - Add `sendMessageWithInlineKeyboard(chatId: string, text: string, buttons: InlineKeyboardButton[][]): Promise<SendResult>` to `TelegramMessengerAdapter`.
  - Decide whether to extend `MessagingOutputPort` or create a narrow output port for keyboards (prefer the narrow port to keep the core messaging contract stable).
- [x] Update `src/infrastructure/adapters/telegram/TelegramExpenseSummaryPresenter.ts`:
  - `presentSummary()` now sends the summary with Confirm / Correct / Cancel inline buttons.
  - Buttons use stable callback data (e.g., JSON with `action`).
- [x] Implement the summary action resolution flow in `src/interfaces/workers/message.worker.ts` (or a dedicated use case such as `ResolveExpenseSummaryActionUseCase`):
  - **Confirm**: invoke `registerExpense.save()` and send a saving/confirmation message.
  - **Correct**: transition to `EXPENSE_CORRECTING` and ask which field to change (stub until E1-US-07 is implemented).
  - **Cancel**: transition to `IDLE` and send the cancellation copy.
  - The route/worker only deserializes callback data and delegates; no business logic lives in the route.
- [x] Update `src/application/use-cases/conversation/RouteIncomingMessage.ts` to route `CALLBACK` payloads to the `process-message` queue so the thick worker can resolve them in FSM context.
- [x] Update `src/bootstrap/buildDependencies.ts` and `src/interfaces/workers/message.worker.ts` to inject the new dependencies (presenter, action resolver).
- [x] Add integration tests:
  - `TelegramExpenseSummaryPresenter` sends the expected markdown text and inline keyboard layout.
  - `TelegramPayloadParser` correctly parses callback queries.
  - `message.worker.ts` routes Confirm/Correct/Cancel callbacks to the right downstream behavior.
- [x] Add remaining unit tests covering all Gherkin scenarios from E1-US-06:
  - Happy path.
  - Low-confidence category marker.
  - Missing date defaults to "today".
  - High-amount warning.
  - Timeout reminder and cancellation.
- [x] Update `docs/features/expense-summary-review.md` with the inline-button and callback-resolution behavior.
- [x] After full implementation, update the user-story task files under `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-06-interpreted-expense-summary-for-review/tasks/` by checking off the acceptance criteria that were satisfied.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases of this plan are complete. The next conversation should review the remaining lint/typecheck issues (if any), decide whether to commit, and then move on to the next user story (e.g., E1-US-07 field correction or E1-US-09/E1-US-10 save/cancel flows).
