# Feature: Expense confirmation

## Purpose

Let a user finish an expense registration from `EXPENSE_REVIEW` with a minimal fixed-vocabulary reply, while ensuring that a correction or unknown reply cannot accidentally save the expense.

## Behavior (Implemented)

- A reply is a confirmation only when the entire message, after case/accent normalization, whitespace collapse, and removal of the allowed surrounding punctuation `¿?¡!.,`, equals one allowlisted phrase. Concatenated affirmatives, internal punctuation, quotes, emoji, negation, conditions, correction text, and prompt injection are never authorization.
- The standard vocabulary is: `sí`, `si`, `ok`, `dale`, `confirmo`, `correcto`, `listo`, and `va`.
- Compatible colloquial variants are: `bárbaro`, `okey`, `perfecto`, `yep`, and `sip`.
- Regional coverage includes Spain: `vale`; Argentina: `dale`, `bárbaro`; Mexico: `va`, `órale` and `orale`; Chile: `ya`.
- Valid confirmation delegates to `ResolveExpenseSummaryActionUseCase`, which starts the existing E1-US-10 save path without asking for an additional confirmation.
- After a confirmed spreadsheet write, the successful confirmation includes the expense concept, amount, currency, destination sheet, and row number when the provider returns one. If the provider confirms the write but omits the row, the message names the destination sheet without a row reference.
- Cancellation delegates to the same existing action resolver and keeps its established transition to `IDLE`.
- A mixed reply, such as `comida sí, pero el monto no`, is not a confirmation. It is delegated to `CorrectExpenseUseCase` through the E1-US-07 correction flow before any save occurs.
- Enabled semantic review routing follows the same authority boundary. `sí, pero cambia el importe a 25` is dispatched as a validated correction, advances the review binding, presents the corrected amount, and requires a new explicit bound confirmation.
- Non-confirm and non-cancel replies are interpreted contextually as `correction`, `new_expense`, or `unrelated`. Only `new_expense` is admitted to the FIFO queue; amount-bearing corrections such as `eran 35 EUR y la categoria es transporte` remain attached to the active review.
- An uninterpretable reply keeps the `EXPENSE_REVIEW` payload and FSM state unchanged and sends exactly: `¿Confirmamos el registro tal como está, lo corregimos o lo cancelamos?`.
- Callback **Confirmar**, **Corregir**, and **Cancelar** actions use `er1:<c|e|x>:<operationId>:<revision-base36>`. The resolver compares the callback with the persisted, successfully presented review binding before any cancellation, correction, or save.
- Text authorization is accepted only for the current binding and only when its channel timestamp is later than `presentedAt`. A queued affirmative captured before presentation cannot bind to a later review.
- The action resolver reloads the reviewed expense from the current FSM payload; caller-supplied expense data is not authority. It returns `handled`, `stale`, `expired`, `unbound`, `invalid`, `operation_in_progress`, or `review_required`.
- Legacy callbacks and legacy review JSONB are unbound. They cause a newly bound safe presentation and require a new user action; the triggering action never saves or cancels.
- Accepting a zero-amount stage advances the review binding and presents the full summary; a second explicit confirmation is required to save.
- A Google Sheets append is successful only after the provider confirms it. Only then does the system persist the expense record and send the E1-US-10 save confirmation.
- When a confirmed `subcategoria` mapping exists, the append writes the reviewed child snapshot at that exact column index, or `null` for a valid no-child selection. Without the mapping, the row length and every existing mapped position remain unchanged.
- The local record written after provider confirmation stores nullable category/subcategory stable IDs and immutable display snapshots. A configured hierarchy may therefore be retained locally even when the spreadsheet has no mapped child column.
- Normal OAuth access-token expiration is recovered silently before the append. If Google returns `AUTH_ERROR` for a token considered valid, the save forces one refresh and replays the append exactly once; only the single provider-confirmed append is persisted.
- Transparent refresh does not restart onboarding, replay expense interpretation/NLP, alter spreadsheet/category configuration, or emit authorization-failure copy.
- Before a Google Sheets `USER_ENTERED` append, textual cell values whose first meaningful character is `=`, `+`, `-`, or `@` are prefixed with an apostrophe. This includes leading whitespace and control characters; numbers, null values, ordinary text, and already apostrophe-prefixed values are preserved.
- A failed append creates an `EXPENSE_SAVE_FAILED` audit entry. It never creates an expense record or sends the successful-save confirmation.
- Retryable failures known to occur before an append reached the spreadsheet persist the complete confirmed review payload, including hierarchy capability, statuses, IDs, and snapshots, in `EXPENSE_SAVING_RETRY` for ten minutes. The retry offer has its own opaque operation ID/revision and successful-presentation timestamp. Exact `reintentar` is accepted only after that offer was successfully delivered and only when the channel timestamp is strictly later than the presentation.
- Legacy or failed-delivery retry context is persisted and re-presented before it can authorize an append; the triggering `reintentar` never performs the retry. Expired, malformed, duplicate, superseded, and unresolved-claim attempts make no external call.
- Confirmation first persists a unique save claim with the immutable reviewed expense. The spreadsheet append begins only while the execution context still owns that claim; success/failure finalization requires the same claim. Retry atomically consumes its exact presented binding into a second, single-use claim before its external call. Unresolved or unknown provider outcomes remain claimed across process restart and are never automatically replayed.
- Transport failure or HTTP 5xx after an append request is sent, and local persistence failure after provider success, are `outcome_unknown`. The state retains the matching claim, no retry is offered, and the user receives `El resultado de esa operación todavía no está confirmado. Revisá la planilla antes de volver a intentarlo.`
- A successful reattempt uses the normal E1-US-10 confirmation once. A second failed attempt clears the retry state and sends a manual-copy fallback containing the concept and amount.
- Terminal authorization failures transition to contextual `ONBOARDING_START` with `promptShown: true` and direct the user to `empezar`. This occurs only when refresh credentials are missing, revoked, undecryptable, rejected by Google, or the one refreshed replay is still unauthorized. That next reply starts a fresh Google authorization flow without generic expense guidance or automatic replay of the failed expense. Structure failures direct the user to `reconfigurar`, which restarts access validation and column inference for the active Google spreadsheet.
- Retry state that is expired or malformed is cleared and receives the restart/manual-resolution response. The commands `reintentar` and `reconfigurar` are only active in `EXPENSE_SAVING_RETRY`.
- When pending expenses exist, a successful save is delivered first, then the queue notice, then the next review. The final queued confirmation sends the batch closing copy only after the save returns the FSM to `IDLE`.
- Pending-expense queue feedback remains in Spanish throughout the flow. A queue-aware unrelated reply sends `Todavía tenés un gasto pendiente de confirmación y {pendingCount} más en la cola. ¿Querés confirmar, corregir o cancelar el actual?` without changing the review or queue.
- A semantic `register_expense` proposal during review invokes `QueuePendingExpense` directly and never invokes correction interpretation. Full queues preserve the active review and report the existing overflow copy.

## API / Interface

No HTTP route is added. `ResolveExpenseReviewReplyUseCase.execute(input)` receives the captured channel timestamp and source message ID. `ResolveExpenseSummaryActionUseCase.execute(input)` receives deterministic authorization evidence and reloads the current persisted review. `expenseCopies.expenseSavedConfirmation(input)` remains the successful-save copy contract.

## Data Model

The `EXPENSE_REVIEW` JSONB payload includes `reviewBinding: { operationId, revision, presentedAt }`. `operationId` is a random 128-bit value encoded as 22 base64url characters; review revision is a positive safe integer independent from the conversation row CAS revision. `presentedAt` remains null until delivery succeeds. Retryable failures persist an `ExpenseSaveRetryPayload` only in `EXPENSE_SAVING_RETRY`.

## Tests

- `intents.spec.ts` covers the complete standard and regional vocabulary, normalization, mixed replies, and partial-word rejection.
- `ResolveExpenseReviewReplyUseCase.spec.ts` covers confirmation, cancellation, correction routing, and uninterpretable replies.
- `ResolveExpenseReviewReplyUseCase.spec.ts` and `message.worker.spec.ts` also prove contextual correction precedence, typed additional-expense admission, queue overflow without review mutation, and the reported `eran 35 EUR...` regression.
- `message.worker.spec.ts` covers delegation, orientation copy, callback regression, zero-amount confirmation, correction cycle limits, and high-amount review behavior.
- `DispatchExpenseSemanticAction.spec.ts` and `message.worker.spec.ts` cover semantic correction/queue separation, old-binding rejection, and one accepted confirmation for the newly presented corrected binding.
- `semantic-router-expense-flows.integration.spec.ts` drives the canonical Telegram webhook through PostgreSQL/Redis and proves no record or spreadsheet append occurs before the latest bound confirmation; the final persisted row retains the original multiline source and exact `16.55 EUR` date-only expense.
- `ResolveExpenseSummaryActionUseCase.spec.ts` covers the success confirmation with complete and omitted row metadata.
- `RouteIncomingMessage.spec.ts` and `message.worker.spec.ts` cover the contextual `AUTH_ERROR → empezar → OAuth` recovery route while retaining ordinary `IDLE` guidance behavior.
- `expense.copies.spec.ts` covers the location-aware successful-save copy.
- `expense.copies.spec.ts` covers Spanish queue copies, singular and plural grammar, and rejects the former English wording. `message.worker.spec.ts` reproduces the reported correction and `y?` sequence without queue admission, hanging, or language switching.
- `ResolveExpenseSummaryActionUseCase.spec.ts` proves explicit confirmation saves the corrected `35 EUR` payload exactly once and never emits the original `30 EUR` amount as saved.
- `expense-confirmation-context.e2e.spec.ts` rejects old confirm/correct/cancel callbacks after replacement, saves the persisted corrected amount once, rejects duplicate/legacy/malformed/pre-presentation/expired evidence, and covers unresolved claims and zero-stage rebinding.
- `expense-review-binding.spec.ts`, `expense-review-callback.spec.ts`, and `intents.spec.ts` cover persisted validation, codec strictness and the complete whole-message authorization policy.
- `expense-save-failure-recovery.integration.spec.ts` wires the real save orchestration with boundary mocks and proves an unconfirmed append emits recovery copy without persisting an expense or emitting E1-US-10 confirmation.
- `GoogleSheetsAdapter.spec.ts` verifies formula-prefix escaping and the final serialized append request body.
- `OAuthAccessTokenService.spec.ts` covers fresh-token reuse, proactive and forced refresh, encrypted persistence with a new IV, terminal revocation, transient refresh failures, and a single replay after provider authorization failure.
- `RegisterExpense.spec.ts` proves an expired token can save without NLP replay or onboarding transition, and that an authorization retry produces one successful append and one local expense record.
- `RegisterExpense.spec.ts` also proves exact mapped-child, mapped-no-child, unmapped, configured-without-mapping, category-only, legacy, and append-failure row/persistence contracts.
- `subcategory-expense-lifecycle.e2e.spec.ts` drives worker confirmation, retry, success messaging, local hierarchy persistence, category-only row compatibility, and exact-row undo through real application use cases with mocked provider boundaries.
- PostgreSQL integration tests run the generated migration chain and verify null legacy history, immutable snapshots, hierarchy indexes, optional mapping validation, and `ON DELETE SET NULL` references.
- `UndoLastExpense.spec.ts` proves delete works after proactive refresh and receives at most one forced-refresh replay.
- A connected staging verification must measure the elapsed time from user confirmation to successful save confirmation against the normal-condition ≤3-second target. Unit tests intentionally do not assert that wall-clock threshold because they mock spreadsheet and messaging boundaries.

## Related User Stories

- [E1-US-06 - Interpreted expense summary for review](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-06-interpreted-expense-summary-for-review/E1-US-06%20%E2%80%94%20Interpreted%20expense%20summary%20for%20review.md)
- [E1-US-07 - Correct an erroneous field in natural language](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-07-correct-an-erroneous-field-in-natural-language/E1-US-07%20%E2%80%94%20Correct%20an%20erroneous%20field%20in%20natural%20language.md)
- [E1-US-08 - Confirm expense registration with a minimal response](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-08-confirm-expense-registration-with-a-minimal-response/E1-US-08%20%E2%80%94%20Confirm%20expense%20registration%20with%20a%20minimal%20response.md)
- [E1-US-10 - Confirmation of saving with a reference to the spreadsheet location](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-10-confirm-saving-with-reference-to-spreadsheet-location/E1-US-10%20%E2%80%94%20Confirmation%20of%20saving%20with%20a%20reference%20to%20the%20spreadsheet%20location.md)

## Notes

`message.worker.ts` is an Interfaces-layer adapter: it validates the review payload, delegates a text reply once, and renders the typed outcome. It does not guess correction intent with a regular expression. `ResolveExpenseReviewReplyUseCase` owns confirmation, cancellation, contextual correction, and new-expense queue precedence without depending on Telegram, WhatsApp, workers, or infrastructure adapters. The persisted FSM follows ADR-003; the asynchronous worker pipeline follows ADR-005 and ADR-011.
