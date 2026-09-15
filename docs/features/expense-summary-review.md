# Feature: Expense summary review

## Purpose

After the user describes an expense in natural language, the system interprets the message and presents a structured summary before saving anything. The summary lets the user verify the extracted concept, amount, currency, category, optional subcategory, and date, and choose to confirm, correct, or cancel the registration.

## Behavior (Implemented)

- The summary always includes the five minimum fields: concept, amount, currency, category, and date.
- Hierarchy-enabled reviews add a subcategory row between category and date. A selected child shows its resolved name; a valid category without a matching child shows `❓ Sin subcategoría` and remains confirmable.
- Hierarchy support is enabled when registration found a confirmed `subcategoria` mapping or at least one active configured child. Category-only users do not receive the extra row.
- Category and subcategory confidence/status values remain independent. Ambiguous or low-confidence child selections show `(¿correcto?)`, fallback children show `(sugerida)`, and confirmed high-confidence children have no suffix.
- Review payloads created after hierarchy classification explicitly include nullable child name/ID, child status, and `subcategoryEnabled`. At the persisted TypeScript boundary these fields remain optional for compatibility.
- A legacy `EXPENSE_REVIEW` payload with missing hierarchy fields is normalized locally. A missing review binding is never treated as presentation proof: the payload is upgraded, persisted, and re-presented before a new user action can authorize anything.
- When the original message did not mention a date, the summary shows `"today"` as the default value.
- Categories with low confidence (`categoryStatus` other than `confirmed` or `categoryConfidence` other than `alta`) are visually marked with `(¿correcto?)` in the Telegram message.
- The summary includes instructions to confirm, correct, or cancel the entry.
- The presentation is channel-agnostic: `GenerateExpenseSummaryUseCase` builds a plain `ExpenseSummary` DTO and delegates rendering to an `ExpenseSummaryPresenter` implementation.
- The Telegram presenter formats the summary as a markdown message and sends it through the existing messaging port.
- Unusually high amounts (above `HIGH_AMOUNT_THRESHOLD_MULTIPLIER` times the user's historical average) are flagged with `isHighAmount` and `requiresExplicitConfirmation`. The Telegram message prepends a warning and asks for explicit confirmation.
- The `EXPENSE_REVIEW` state tracks `reminderSent` and a validated `reviewBinding` in its payload. Presentation persists the binding first and conditionally records `presentedAt` only after successful delivery.
- `HandleExpiredSessions` implements the two-stage timeout:
  - First expiry: invalidates the previous binding, commits the one-time grace TTL, sends the queue-aware reminder, and presents a newly bound summary.
  - Second expiry: transitions to `IDLE` and sends the cancellation notice via `notifyCancellation()`.
- All other expired states keep the existing generic timeout message.
- Enabled semantic registration from `IDLE` or `EXPENSE_RECEIVING` reuses the same `RegisterExpenseUseCase.interpret` and summary presenter path. It can reach `EXPENSE_REVIEW`, including zero/high-amount presentation guards, but cannot invoke save or send a saved confirmation.

## Behavior (Implemented)

- The summary is presented as a Telegram message with inline buttons: **Confirmar**, **Corregir**, and **Cancelar**.
- Telegram `callback_query` updates are parsed into a strict bound callback, an unbound legacy action, or an explicit invalid-version marker. Malformed versioned data is never downgraded to legacy.
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

- `conversation_states.state_payload` stores the `ExpenseReviewPayload` produced by `RegisterExpenseUseCase` while the user is in `EXPENSE_REVIEW` state. New payloads carry stable nullable category/subcategory IDs, resolved names, independent statuses, `subcategoryEnabled`, and `reminderSent`.
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
- [x] Enabled reviews render selected, absent, ambiguous, fallback, and independently confident subcategories.
- [x] Disabled and legacy reviews preserve the existing five-field Telegram output.
- [x] Initial review, zero-amount completion, clarification completion, correction, and re-presentation paths delegate through the same summary use case without adding an FSM state or duplicate presentation.

## Related User Stories

- `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-06-interpreted-expense-summary-for-review/E1-US-06 — Interpreted expense summary for review.md`

## Notes

- The `expenseSummaryPresenterFactory` is currently wired to the Telegram presenter. A WhatsApp presenter can be added later without changing the use case.
- The "Correct" action uses an inline button and transitions to `EXPENSE_CORRECTING`; the natural-language correction flow is documented in [`expense-correction.md`](./expense-correction.md).
- The presenter exposes `showTimeoutWarning`, `notifyCancellation`, and `requestHighAmountConfirmation` methods used by `HandleExpiredSessions` and high-amount flows.
- This review phase does not write subcategories to spreadsheets or persist them on expense records. Those operations remain deferred to the persistence and release subplan.
