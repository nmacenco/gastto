# Feature: Expense summary review

## Purpose

After the user describes an expense in natural language, the system interprets the message and presents a structured summary before saving anything. The summary lets the user verify the extracted concept, amount, currency, category, and date, and choose to confirm, correct, or cancel the registration.

## Behavior (Implemented)

- The summary always includes the five minimum fields: concept, amount, currency, category, and date.
- When the original message did not mention a date, the summary shows `"today"` as the default value.
- Categories with low confidence (`categoryStatus` other than `confirmed` or `categoryConfidence` other than `alta`) are visually marked with `(¿correcto?)` in the Telegram message.
- The summary includes instructions to confirm, correct, or cancel the entry.
- The presentation is channel-agnostic: `GenerateExpenseSummaryUseCase` builds a plain `ExpenseSummary` DTO and delegates rendering to an `ExpenseSummaryPresenter` implementation.
- The Telegram presenter formats the summary as a markdown message and sends it through the existing messaging port.
- Unusually high amounts (above `HIGH_AMOUNT_THRESHOLD_MULTIPLIER` times the user's historical average) are flagged with `isHighAmount` and `requiresExplicitConfirmation`. The Telegram message prepends a warning and asks for explicit confirmation.
- The `EXPENSE_REVIEW` state tracks `reminderSent` in its payload.
- `HandleExpiredSessions` implements the two-stage timeout:
  - First expiry: sends a one-time reminder via `showTimeoutWarning()` and extends the state TTL by `EXPENSE_REVIEW_REMINDER_TIMEOUT_MINUTES`.
  - Second expiry: transitions to `IDLE` and sends the cancellation notice via `notifyCancellation()`.
- All other expired states keep the existing generic timeout message.

## Behavior (Implemented)

- The summary is presented as a Telegram message with inline buttons: **Confirmar**, **Corregir**, and **Cancelar**.
- Telegram `callback_query` updates are parsed into `CALLBACK` message payloads with `{ action: 'confirm' | 'correct' | 'cancel'; field?: string }`.
- `RouteIncomingMessage` routes `CALLBACK` payloads to the `process-message` queue so the thick worker can resolve them in FSM context.
- `ResolveExpenseSummaryActionUseCase` handles the three actions:
  - **Confirm**: invokes `RegisterExpenseUseCase.save()` and sends a saving/confirmation message.
  - **Correct**: transitions to `EXPENSE_CORRECTING` and asks for a natural-language correction. See [`expense-correction.md`](./expense-correction.md).
  - **Cancel**: delegates to the shared expense-cancellation path, which clears the active state before sending the cancellation copy. See [`expense-cancellation.md`](./expense-cancellation.md).
- The messaging adapter contract remains stable: `MessagingOutputPort` handles plain text, while a narrow `InlineKeyboardOutputPort` is used for inline keyboards.
- Legacy text-based confirm/cancel intents are still supported as a fallback. Global cancellation commands also work from clarification and correction states.

## API / Interface

- No HTTP endpoints are added in this feature. The summary is delivered through the messaging channel (Telegram in Phase 1).

## Data Model

- `conversation_states.state_payload` stores the `ExpenseReviewPayload` produced by `RegisterExpenseUseCase` while the user is in `EXPENSE_REVIEW` state. The payload now includes `reminderSent` to implement the two-stage timeout.
- `expense_records.monto` is averaged per user (excluding soft-deleted records) to detect unusually high amounts.
- `ExpenseSummary` is a transient DTO used only between the use case and the presenter; it is not persisted.

## Tests

- [x] `GenerateExpenseSummaryUseCase` builds a summary with all five fields.
- [x] Missing date defaults to `"today"` in the summary.
- [x] Low-confidence category values are preserved in the DTO for the presenter to mark.
- [x] `message.worker.ts` delegates summary rendering to the use case and presenter instead of formatting inline.
- [x] High amounts above the configured multiplier of the user's historical average set `isHighAmount` and `requiresExplicitConfirmation`.
- [x] No high-amount warning when the user has no expense history.
- [x] `HandleExpiredSessions` sends a reminder and extends TTL on the first `EXPENSE_REVIEW` expiry.
- [x] `HandleExpiredSessions` transitions to `IDLE` and notifies cancellation on the second `EXPENSE_REVIEW` expiry.
- [x] `TelegramPayloadParser` parses `callback_query` updates into `CALLBACK` payloads with action data.
- [x] `TelegramMessengerAdapter` sends messages with inline keyboard markup.
- [x] `TelegramExpenseSummaryPresenter` renders the summary and Confirm / Correct / Cancel buttons.
- [x] `ResolveExpenseSummaryActionUseCase` confirms, corrects, and cancels expense reviews.
- [x] `RouteIncomingMessage` routes `CALLBACK` payloads to the `process-message` queue.
- [x] `message.worker.ts` routes Confirm / Correct / Cancel callbacks to `ResolveExpenseSummaryActionUseCase`.

## Related User Stories

- `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-06-interpreted-expense-summary-for-review/E1-US-06 — Interpreted expense summary for review.md`

## Notes

- The `expenseSummaryPresenterFactory` is currently wired to the Telegram presenter. A WhatsApp presenter can be added later without changing the use case.
- The "Correct" action uses an inline button and transitions to `EXPENSE_CORRECTING`; the natural-language correction flow is documented in [`expense-correction.md`](./expense-correction.md).
- The presenter exposes `showTimeoutWarning`, `notifyCancellation`, and `requestHighAmountConfirmation` methods used by `HandleExpiredSessions` and high-amount flows.
