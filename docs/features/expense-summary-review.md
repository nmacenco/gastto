# Feature: Expense summary review

## Purpose

After the user describes an expense in natural language, the system interprets the message and presents a structured summary before saving anything. The summary lets the user verify the extracted concept, amount, currency, category, optional subcategory, and date, and choose to confirm, correct, or cancel the registration.

## Behavior (Implemented)

- The summary includes concept, amount, currency, category, date, and payment method (`Sin medio de pago` when absent).
- A configured catalog resolves exact normalized payment names to stable IDs. Unknown names remain visible as unresolved and hide **Confirmar** until the user chooses an existing method, explicitly adds the displayed unknown name, or clears the payment. Resolution advances the review binding and requires a new successful presentation. Legacy reviews retain their original payment text without an ID.
- Initial extraction infers category and optional subcategory from the expense concept or merchant against the user's configured vocabulary; it is not limited to category names written literally by the user. When configured vocabulary exists, provider suggestions must use its exact names or remain unclassified.
- Category classification recognizes an explicitly mentioned active category (including multi-word names), uses the LLM category as additional keyword evidence, and gives fallback mapping the complete active category list rather than only canonical-looking labels.
- Exact active LLM suggestions with low confidence are retained as ambiguous selections, including custom names such as `Gastos diarios`. Without a usable provider suggestion, negations and multiple alternative category mentions remain unclassified; contained names prefer the longer phrase unless the shorter name is also mentioned separately.
- Category fallback uses textual similarity, not semantic inference: `food` does not automatically map to `Gastos diarios`. Merchant-to-custom-category inference still depends on the provider; the prompt contract alone does not verify live provider quality.
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
- Enabled semantic routing in `EXPENSE_REVIEW` can propose `correct_expense` or `register_expense`. A correction runs once in validated-correction mode, advances the review binding, and presents a new summary before any confirmation can save. A new expense is admitted directly to the existing two-item FIFO queue without replacing or saving the active review.
- Queue overflow, invalid review context, invalid subcategory, correction-cycle exhaustion, and extraction/correction failure retain controlled review guidance. They do not mutate the active review, queue, expense records, or spreadsheet.

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

## Initial extraction failures

The shared LLM provider can be selected with `LLM_PROVIDER`. `auto` preserves the
existing NVIDIA, Anthropic, OpenAI priority; an explicit choice requires that
provider's key. `LLM_FALLBACK_PROVIDER=auto` uses one different configured provider
for initial expense extraction after a typed provider, timeout, or invalid-output
failure. The first attempt receives half the configured extraction deadline and
the backup receives the remaining time. Caller cancellation never starts the
backup. `none` disables it, and one configured key alone provides no fallback.
Both attempts reuse the original message and correlation ID. No failed attempt
can save a record; review and explicit confirmation remain required. Correction
and other shared LLM operations use the primary provider only.

Groq is available by explicit `LLM_PROVIDER=groq` or
`LLM_FALLBACK_PROVIDER=groq` with its own `GROQ_API_KEY` and optional
`GROQ_MODEL` (default `openai/gpt-oss-20b`). The primary setting also directs
correction and response generation to Groq; the fallback setting applies only
to initial extraction. Development uses Groq as explicit primary with NVIDIA
as extraction fallback. Representative expense reviews and one confirmed save
passed in development; both `auto` priorities remain unchanged. See the
[validation record](../../ai/plans/2026_10_22-integrate_groq_expense_extraction/validation.md)
for evidence and limits. For the exact
`openai/gpt-oss-20b` and `openai/gpt-oss-120b` models, expense extraction requests
use Groq's strict JSON Schema mode with all eight fields required, nullable
unknown values, low reasoning effort, and a 1024-token completion cap. Other
configured Groq models keep JSON object mode. Local schema validation and the
explicit review and save confirmation remain required. This change addresses
a possible JSON generation failure behind an HTTP 400, but an HTTP status alone
does not establish the provider's exact error reason.

Before a review is built, all provider extraction requests have a configurable 30-second default deadline with real transport cancellation. Empty/blank responses, truncated output, invalid JSON/schema, provider failures, timeout, and cancellation have separate safe diagnostic codes. Only validated final response content enters the expense workflow. The exact NVIDIA `z-ai/glm-5.3-flash` extraction profile uses low reasoning with a 4096-token cap; user-reported registration acceptance and the limits of live evidence are recorded in the [validation record](../../ai/plans/2026_09_23-fix_expense_extraction_failures/validation.md).

Extraction completion logs include the configured deadline. NVIDIA extraction also records the request size in bytes and the phase reached (`awaiting_headers`, `reading_body`, `streaming_body`, or `processing_response`) without logging the prompt or provider response. A timeout in `awaiting_headers` means no HTTP response headers reached the adapter before its deadline; it does not distinguish provider generation time from network delay.

For the exact NVIDIA model `z-ai/glm-5.3-flash`, initial extraction requests use streaming. The adapter assembles only final-answer content from SSE events, discards reasoning text, and waits for the completion marker before validating the JSON. It records the first event latency and counts of stream/reasoning events without recording their text. The same configured deadline bounds the entire stream; receiving early events does not extend it. Other NVIDIA model IDs retain their JSON response path.

The initial review resolves dates deterministically before classification, clarification, or review persistence. Supported explicit formats are `YYYY-MM-DD`, day-first `D/M/YYYY`, and `D month YYYY` with English or Spanish full month names or abbreviations (including `sept`, `ene`, `abr`, `ago`, and `dic`, with an optional abbreviation period). These formats may end in ` at HH:mm` or `, HH:mm`; hours must be 00–23 and minutes 00–59. For example, `24 Nov 2026 at 17:12` becomes `2026-11-24`, preserving the written day without UTC conversion. Month lengths, leap years, and nonzero calendar components are validated for every format. Trailing text, ISO timestamps, month-first numeric dates, and unrecognized formats are rejected rather than guessed.

Only a null date defaults to the local calendar day captured once at the start of interpretation. Blank or invalid explicit strings never default to today. Spanish `hoy`, `ayer`, and `mañana` resolve relative to that captured local day; these values remain compatible with date correction.

Post-extraction date failures use the application error `EXPENSE_DATE_INVALID` with a safe reason (`unsupported-format` or `invalid-calendar-date`), distinct from provider failures. The worker sends “No pude interpretar la fecha de este gasto. Usá el formato AAAA-MM-DD, por ejemplo 2026-11-24.” Cancellation guidance is added only when the reloaded persisted state permits it; unresolved financial claims retain administrator guidance. No review, expense record, spreadsheet append, or success message is produced. For an eligible initial receiving attempt, the owned revision is reset before date-specific resend guidance is sent, as described below. Re-interpretation during clarification, replacement, correction, or a queued batch does not use this reset.

The shared provider prompt requests an explicit calendar date as `YYYY-MM-DD`, preserves the stated day, and uses null only when no date was supplied. Unsupported explicit text is retained for validation. The nullable-string extraction schema is unchanged, and provider compliance is never assumed.

A typed LLM failure (except cancellation) or an `EXPENSE_DATE_INVALID` failure on an initial attempt from `IDLE` or `EXPENSE_RECEIVING` resets only its owned receiving revision to `IDLE`, clearing its failed payload and expiry before notifying the user. Queued-batch interpretation, clarification, and correction do not use this reset. A retained receiving payload with a queue batch count is also protected if a caller omits that count. No expense record or spreadsheet row is written on this path. The user can resend the expense and must still confirm its review before saving. Recovery uses an unexpired database precondition when the receiving attempt has an expiry. Classifier, context-loading, and persistence failures remain outside extraction/date recovery. Semantic dispatch propagates interpretation failures to the worker and never performs a second generic reset.

Public failure copies after successful recovery:

- Invalid date: “No pude interpretar la fecha de este gasto. No lo guardé. Volvé a enviarlo con una fecha como 2026-11-24.”
- Timeout: “La interpretación tardó demasiado. No guardé este gasto. Volvé a enviarlo para intentar de nuevo”.
- Invalid output/provider failure: “No pude interpretar este gasto. No lo guardé. Volvé a enviarlo para intentar de nuevo”.

The recovered error carries the committed IDLE revision and, for dates, its diagnostic reason. Before sending resend guidance, the worker reloads state and requires that same IDLE revision, no financial claim, and a valid lease. A newer revision or an unavailable state read suppresses the recovery notice. A stale revision or invalidated lease cannot reset another attempt or send a false recovery message. Recovery persistence failures propagate to the generic handler, without labeling the failed reset as recovered. Generic fallback copy is “Parece que algo falló. Revisá el último mensaje del chat.” with state-appropriate cancellation guidance, and makes no state-reset promise.

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
- [x] Enabled review correction, direct queue admission, queue overflow, stale binding rejection, and exact-once corrected confirmation are covered at dispatcher and worker boundaries.
- [x] PostgreSQL/Redis conversation coverage preserves the active review through two queued expenses and overflow, invalidates the old correction binding, and saves only the newly presented binding once.

- [x] Full Mercadona receipt (`24 Nov 2026 at 17:12`, `13,79 €`) reaches review with calendar date `2026-11-24`, amount `13.79`, and currency `EUR`, without saving.
- [x] Resolver rejects impossible dates and invalid/trailing time text; missing dates and receipt days are verified around midnight under Madrid, Los Angeles, and Kiritimati time zones.
- [x] Typed date failures reach controlled worker guidance and safe logs, including semantic dispatch; invalid corrections preserve the previous review.

## Related User Stories

- `docs/user-stories/01-mvp/02-Registro de Gastos/E1-US-06-interpreted-expense-summary-for-review/E1-US-06 — Interpreted expense summary for review.md`

## Notes

- The `expenseSummaryPresenterFactory` is currently wired to the Telegram presenter. A WhatsApp presenter can be added later without changing the use case.
- The "Correct" action uses an inline button and transitions to `EXPENSE_CORRECTING`; the natural-language correction flow is documented in [`expense-correction.md`](./expense-correction.md).
- The presenter exposes `showTimeoutWarning`, `notifyCancellation`, and `requestHighAmountConfirmation` methods used by `HandleExpiredSessions` and high-amount flows.
- This review phase does not write subcategories to spreadsheets or persist them on expense records. Those operations remain deferred to the persistence and release subplan.

### Extraction regression coverage

- `extractionRuntime.spec.ts` and `GroqAdapter.spec.ts`: provider boundaries, typed failures, safe metadata, deadlines, SDK retry settings, ownership cancellation, late completion, response-body abort, and model-specific request behavior.
- `RecoverExpenseExtraction.spec.ts`: exact revision recovery, stale ownership, persistence failure, newer drafts, and unresolved financial claims.
- `semantic-router-expense-flows.integration.spec.ts`: real PostgreSQL/Redis, routing off, failed initial extraction from idle/receiving, resend, review, explicit confirmation, and exactly one write after duplicate confirmation.

## Recovery guidance (2026-11-15)

Shared semantic feedback reloads the persisted state before choosing recovery instructions, including after stale or rejected dispatch. It never derives cancellation solely from the incoming review snapshot. Changed or expired context uses current or bounded guidance; financial claims use manual-resolution feedback.

## Expense message formatting (2026-11-16)

Review summaries preserve field ordering, amounts, dates, hierarchy markers, payment labels, and callback bindings. Confirmation/correction instructions and the optional cancellation footer occupy separate paragraphs. High-amount warnings stay separate, and the final cancellation footer appears only once. Unresolved-payment guidance lists the accepted commands and still omits the Confirmar button. See [conversational message formatting](./conversational-message-formatting.md).

## Final readability audit (2026-11-16)

Queue-full guidance separates the queue limit from the instruction to finish or cancel the active expense. Queue size, callback eligibility and ordering remain unchanged. See [conversational message formatting](./conversational-message-formatting.md) for scope and intentional exceptions.

## Receipt recovery validation (2026-11-25)

The PostgreSQL/Redis expense-flow harness verifies direct registration and invalid-date recovery from IDLE/receiving with semantic routing off and enabled, followed by a visible date/amount/currency review and exactly one saved row despite duplicate confirmation. It uses actual classification, application use cases, and database repositories, with provider, OAuth, spreadsheet, semantic proposal, and messaging boundaries replaced locally. Invalid clarification answers/replacements preserve their original persisted revision, and invalid queued interpretation retains its FIFO item without a batch-completion message. See the [acceptance record](../../ai/plans/2026_11_24-fix_expense_receipt_date/validation.md); the original redacted production exception was not inspected.
