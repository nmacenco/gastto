# Feature: Expense confirmation

## Purpose

Let a user finish an expense registration from `EXPENSE_REVIEW` with a minimal fixed-vocabulary reply, while ensuring that a correction or unknown reply cannot accidentally save the expense.

## Behavior (Implemented)

- A reply is a confirmation only when it consists solely of one or more allowed affirmative tokens. Matching is case-insensitive and normalizes whitespace, punctuation, and accents.
- The standard vocabulary is: `sí`, `si`, `ok`, `dale`, `confirmo`, `correcto`, `listo`, and `va`.
- Compatible colloquial variants are: `bárbaro`, `okey`, `perfecto`, `yep`, and `sip`.
- Regional coverage includes Spain: `vale`; Argentina: `dale`, `bárbaro`; Mexico: `va`, `órale` and `orale`; Chile: `ya`.
- Valid confirmation delegates to `ResolveExpenseSummaryActionUseCase`, which starts the existing E1-US-10 save path without asking for an additional confirmation.
- After a confirmed spreadsheet write, the successful confirmation includes the expense concept, amount, currency, destination sheet, and row number when the provider returns one. If the provider confirms the write but omits the row, the message names the destination sheet without a row reference.
- Cancellation delegates to the same existing action resolver and keeps its established transition to `IDLE`.
- A mixed reply, such as `comida sí, pero el monto no`, is not a confirmation. It is delegated to `CorrectExpenseUseCase` through the E1-US-07 correction flow before any save occurs.
- An uninterpretable reply keeps the `EXPENSE_REVIEW` payload and FSM state unchanged and sends exactly: `¿Confirmamos el registro tal como está, lo corregimos o lo cancelamos?`.
- Callback **Confirmar**, **Corregir**, and **Cancelar** actions remain on their existing action-resolver path.
- A Google Sheets append is successful only after the provider confirms it. Only then does the system persist the expense record and send the E1-US-10 save confirmation.
- Before a Google Sheets `USER_ENTERED` append, textual cell values whose first meaningful character is `=`, `+`, `-`, or `@` are prefixed with an apostrophe. This includes leading whitespace and control characters; numbers, null values, ordinary text, and already apostrophe-prefixed values are preserved.
- A failed append creates an `EXPENSE_SAVE_FAILED` audit entry. It never creates an expense record or sends the successful-save confirmation.
- Retryable network failures persist the confirmed review payload in `EXPENSE_SAVING_RETRY` for ten minutes. The recovery copy accepts `reintentar`; it causes exactly one user-initiated reattempt.
- A successful reattempt uses the normal E1-US-10 confirmation once. A second failed attempt clears the retry state and sends a manual-copy fallback containing the concept and amount.
- Authorization failures transition to contextual `ONBOARDING_START` with `promptShown: true` and direct the user to `empezar`; that next reply starts a fresh Google authorization flow without generic expense guidance or automatic replay of the failed expense. Structure failures direct the user to `reconfigurar`, which restarts access validation and column inference for the active Google spreadsheet.
- Retry state that is expired or malformed is cleared and receives the restart/manual-resolution response. The commands `reintentar` and `reconfigurar` are only active in `EXPENSE_SAVING_RETRY`.
- When pending expenses exist, a successful save is delivered first, then the queue notice, then the next review. The final queued confirmation sends the batch closing copy only after the save returns the FSM to `IDLE`.

## API / Interface

No HTTP route or external messaging contract is added. `ResolveExpenseReviewReplyUseCase.execute(input)` is the Application-layer contract for text replies in `EXPENSE_REVIEW`. `expenseCopies.expenseSavedConfirmation(input)` is the public Application copy contract for successful saves; it receives the concept, amount, currency, sheet name, and optional row index.

## Data Model

The feature reuses the persisted `EXPENSE_REVIEW` payload and its existing conversation FSM state. Retryable failures persist an `ExpenseSaveRetryPayload` only in `EXPENSE_SAVING_RETRY`: the confirmed review payload, typed failure code, first-attempt timestamp, and an attempt count of one. Successful saves persist the confirmed destination sheet and an optional spreadsheet row index in `expense_records`; the row index is NULL only when the provider confirms the write without exposing it.

## Tests

- `intents.spec.ts` covers the complete standard and regional vocabulary, normalization, mixed replies, and partial-word rejection.
- `ResolveExpenseReviewReplyUseCase.spec.ts` covers confirmation, cancellation, correction routing, and uninterpretable replies.
- `message.worker.spec.ts` covers delegation, orientation copy, callback regression, zero-amount confirmation, correction cycle limits, and high-amount review behavior.
- `ResolveExpenseSummaryActionUseCase.spec.ts` covers the success confirmation with complete and omitted row metadata.
- `RouteIncomingMessage.spec.ts` and `message.worker.spec.ts` cover the contextual `AUTH_ERROR → empezar → OAuth` recovery route while retaining ordinary `IDLE` guidance behavior.
- `expense.copies.spec.ts` covers the location-aware successful-save copy.
- `expense-save-failure-recovery.integration.spec.ts` wires the real save orchestration with boundary mocks and proves an unconfirmed append emits recovery copy without persisting an expense or emitting E1-US-10 confirmation.
- `GoogleSheetsAdapter.spec.ts` verifies formula-prefix escaping and the final serialized append request body.
- A connected staging verification must measure the elapsed time from user confirmation to successful save confirmation against the normal-condition ≤3-second target. Unit tests intentionally do not assert that wall-clock threshold because they mock spreadsheet and messaging boundaries.

## Related User Stories

- [E1-US-06 - Interpreted expense summary for review](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-06-interpreted-expense-summary-for-review/E1-US-06%20%E2%80%94%20Interpreted%20expense%20summary%20for%20review.md)
- [E1-US-07 - Correct an erroneous field in natural language](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-07-correct-an-erroneous-field-in-natural-language/E1-US-07%20%E2%80%94%20Correct%20an%20erroneous%20field%20in%20natural%20language.md)
- [E1-US-08 - Confirm expense registration with a minimal response](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-08-confirm-expense-registration-with-a-minimal-response/E1-US-08%20%E2%80%94%20Confirm%20expense%20registration%20with%20a%20minimal%20response.md)
- [E1-US-10 - Confirmation of saving with a reference to the spreadsheet location](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-10-confirm-saving-with-reference-to-spreadsheet-location/E1-US-10%20%E2%80%94%20Confirmation%20of%20saving%20with%20a%20reference%20to%20the%20spreadsheet%20location.md)

## Notes

`message.worker.ts` is an Interfaces-layer adapter: it validates the review payload, delegates a text reply once, and renders the typed outcome. `ResolveExpenseReviewReplyUseCase` owns the confirmation, cancellation, and correction precedence rules without depending on Telegram, WhatsApp, workers, or infrastructure adapters. The persisted FSM follows ADR-003; the asynchronous worker pipeline follows ADR-005 and ADR-011.
