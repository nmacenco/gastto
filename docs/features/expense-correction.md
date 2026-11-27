# Feature: Expense correction in natural language

## Purpose

Allow a user reviewing an expense summary to correct the amount, currency, category, optional linked subcategory, date, or payment method by replying in natural language. The correction is applied atomically to the pending review payload, shown again for confirmation, and is not saved to the spreadsheet until the user explicitly confirms it.

## Behavior (Implemented)

- From `EXPENSE_REVIEW`, a non-confirm and non-cancel text message is interpreted as a correction attempt using the current summary as context.
- In enabled semantic mode, an allowed `correct_expense` proposal enters the same correction use case with `intentMode: 'validated_correction'`. Deterministic callers pass `intentMode: 'infer'` explicitly.
- The contextual interpretation returns exactly one typed intent: `correction`, `new_expense`, or `unrelated`. A correction is applied to the active review, a genuine new expense is admitted to the FIFO queue, and an unrelated reply leaves both the active payload and queue unchanged.
- Validated correction mode cannot redirect an extractor result of `new_expense` or `unrelated`; either result becomes controlled clarification with no queue admission or state mutation. Mixed affirmative corrections such as `sí, pero cambia el importe a 25` therefore produce a new review for amount `25`, never authorization to save the old review.
- Queue admission no longer depends on a lexical correction regular expression. Natural variants such as `eran 35 EUR y la categoria es transporte` reach the correction flow even though they also contain an amount and currency.
- From the inline **Corregir** action, `ResolveExpenseSummaryActionUseCase` creates a typed `ExpenseCorrectionState`, transitions to `EXPENSE_CORRECTING`, and sends examples of natural-language corrections.
- The next message in `EXPENSE_CORRECTING` is interpreted against the stored review payload.
- Entering correction from the summary action retains the review's existing expiration deadline. Unknown-category and unknown-subcategory choices opened on the next turn use that same deadline instead of rejecting the current expense as stale because its expiration was cleared.
- The correctable fields are:
  - amount (`monto`),
  - currency (`moneda`),
  - category (`categoria`), resolved through the user's active spreadsheet vocabulary, and
  - linked subcategory (`subcategoria`), resolved only beneath the selected active parent, and
  - date (`fecha`), including supported relative values such as `ayer`, `hoy`, and `mañana`, and
  - payment method (`medio_pago`), including explicit clearing.
- Multiple fields in one message are applied atomically and produce one updated summary presentation.
- Payment corrections resolve exact configured names locally. An unknown name produces an unresolved updated review with no save action; it is never added automatically. Clearing selects `Sin medio de pago`. Provider context treats payment names as untrusted data.
- A combined category/subcategory correction is accepted only when both selections resolve to one active relationship. A child-only correction is scoped to the current active parent and never searches another branch.
- A category-only correction preserves the current child only while its stable ID still belongs to the resolved parent; otherwise every child selection and extraction field is cleared to canonical no-child values.
- When the provider omits `categoria_raw`, recovery accepts only a complete active name or a simple category assignment (for example `corregir categoria: gastos diarios`). Whole-target matching distinguishes `Gastos` from `Gastos diarios`. Negations, alternatives, and other incomplete instructions return `not_interpretable` without advancing the review.
- A category correction that still cannot resolve an active parent is treated as not interpretable and leaves the review unchanged; it is never presented as a successful correction with an empty category.
- When the user explicitly names a category that is absent from the active catalog, the bot retains the reviewed expense and any other corrected fields in a guarded `EXPENSE_CORRECTING` choice. It lists existing categories, offers `elegir Nombre`, `agregar`, `volver`, and `cancelar`, and asks about a suggested existing match when one exists. A name supplied only by the model does not trigger this offer.
- `agregar` only opens a second prompt naming the proposed category. The catalog changes only after `confirmar agregar`; `no` returns to the choices, `volver` restores and re-presents the original expense, and `cancelar` abandons the expense through its existing cancellation path. Replies received before the current choice stage are rejected. Creation and the return to `EXPENSE_REVIEW` share one transaction guarded by conversation revision, choice identity, active configuration, catalog baseline, expiry, and financial claims. A concurrent catalog change refreshes the choices; a stale or repeated confirmation cannot insert twice.
- A selected or newly added category is rebound to its stable ID, an incompatible child is cleared, and the review binding advances before the full expense summary is presented again. The expense is written to the spreadsheet only after its normal confirmation. A newly added catalog entry remains available even if the user later cancels the expense.
- An explicitly named child missing beneath an exact active parent opens the same guarded choice flow, scoped to that parent's active children. The bot offers `elegir Nombre`, `agregar`, `volver`, and `cancelar`; a suggested existing child must be accepted explicitly. If the parent is unknown or only suggested, its choice is resolved first. An invalid child name supplied only by the model still produces parent-specific guidance without changing the review.
- `agregar` opens a separate confirmation naming both child and parent. `confirmar agregar` adds or reactivates that child under the parent and returns to the full pending review with its stable child ID; `no` returns to choices, `volver` restores the original review, and `cancelar` abandons the pending expense. The transaction checks the active parent, source configuration, baseline, choice identity, expiry, and financial claim. A stale or repeated reply cannot add a second child. The catalog entry remains available if the expense is later canceled.
- A child can be added to Gastto even without a mapped `subcategoria` column. The choice message explains that it will appear in the spreadsheet only after that column is configured. The ordinary final expense confirmation remains required to save the expense; the save writes the child only when the column is mapped.
- An unrelated message produces the existing orientation prompt: `¿Querías confirmar, corregir o cancelar el registro?`; it does not transition or save the expense.
- A corrected amount above the user's historical-average threshold is presented with the existing high-amount warning and explicit confirmation prompt. The corrected value remains pending review data until confirmation.
- Correction cycles are counted in `ExpenseCorrectionState`. After five completed cycles, the sixth correction returns the cycle-limit copy and keeps the current correction state instead of presenting another summary.
- Invalid or corrupted correction state is logged with structured context, reset to `IDLE`, and answered with the generic fallback copy.
- Successful corrections reset the review TTL and transition back to `EXPENSE_REVIEW` with the updated payload.
- A successful correction keeps the operation identity, increments the review revision, clears `presentedAt`, persists the corrected payload, and requires successful presentation before new confirmation authority exists. All buttons from the prior summary become stale.
- Persisted legacy extraction, clarification, review, correction, and retry payloads are normalized at the domain boundary. Missing hierarchy fields become explicit `null`, `nula`, `none`, and `false` values; malformed or contradictory canonical payloads are rejected and safely reset by the worker.
- Save retries consume the normalized reviewed expense and never invoke natural-language interpretation. Pending queue rows remain raw messages and enter canonical clarification/review state only after normal FIFO dequeue processing.

## Behavior (TODO)

- Spreadsheet persistence after explicit confirmation belongs to E1-US-08 and is outside this feature's correction flow.

## API / Interface

No HTTP endpoints are added. The feature is driven by the `process-message` BullMQ worker.

### Application and domain contracts

- `ExpenseCorrectionState`: immutable, validated, JSONB-serializable state with the review payload and correction-cycle counter.
- `normalizeExtractedExpensePayload(value)` and `normalizeExpenseReviewPayload(value)`: shared domain validation and legacy-upgrade boundaries used by conversational state consumers.
- `parseExpenseSaveRetryPayload(value)`: validates the retry envelope and normalizes its nested reviewed expense before replay.
- `LLMPort.interpretCorrection(rawMessage, currentExtracted, userContext)`: provider-neutral follow-up interpretation contract returning `intent: 'correction' | 'new_expense' | 'unrelated'` plus corrected values only for the `correction` branch.
- `CorrectExpenseUseCase.execute(input)`: requires `intentMode: 'infer' | 'validated_correction'`, interprets and applies corrections, returns a typed `new_expense` only in inference mode, resolves categories and dates, enforces high-amount and cycle rules, preserves queued-batch progress, and transitions the FSM.
- `ResolveExpenseReviewReplyUseCase.execute(input)`: preserves confirm/cancel precedence and delegates only a typed `new_expense` outcome to `QueuePendingExpense`.
- `MessageWorkerDeps.correctExpense`: injected use case used by the worker for both correction entry points.

### Architectural boundary

- The worker deserializes and validates state, delegates to `CorrectExpenseUseCase`, and presents the returned payload.
- The worker parses every review before confirmation, cancellation, direct correction, callback handling, timeout-related routing, immediate undo re-presentation, or summary presentation. Invalid review data is logged structurally, reset to `IDLE`, and never cast through permissive guards.
- `CorrectExpenseUseCase` owns correction business rules and does not depend on Telegram, WhatsApp, or messaging adapters.
- LLM providers are accessed only through `LLMPort`; OpenAI, Claude, and NVIDIA implementations share the strict correction schema and contextual prompt contract.
- Category resolution uses the existing `ICategoryClassifier` port and spreadsheet vocabulary repositories.

## Data Model

- `conversation_states.current_state` uses `EXPENSE_REVIEW` and `EXPENSE_CORRECTING` from the durable FSM.
- `conversation_states.state_payload` stores the review payload or the serialized `ExpenseCorrectionState` JSONB payload.
- No new database table or migration is required.
- `expense_records` is written only by the existing confirmation flow, after explicit confirmation; correction itself does not persist an expense.
- This compatibility phase does not write subcategories externally, consume review hierarchy IDs in `expense_records`, change undo semantics, or otherwise activate the deferred persistence behavior.

## Tests

The E1-US-07 scenarios map to these tests:

| User-story scenario             | Covering tests                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Amount correction               | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `updates amount when the user corrects it`; `src/interfaces/workers/message.worker.spec.ts` - `applies a direct natural-language correction and presents one updated summary`                                    |
| Category correction             | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `updates category through the classifier`                                                                                                                                                                        |
| Date correction                 | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `updates date to previous day when the user says "ayer"`                                                                                                                                                         |
| Several fields in one message   | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `updates multiple fields in a single execution`; `src/interfaces/workers/message.worker.spec.ts` - `presents exactly one updated summary for an atomic multi-field correction`                                   |
| Unusually high corrected amount | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `requests explicit confirmation for unusually high corrected amounts`; `src/interfaces/workers/message.worker.spec.ts` - `presents a high-amount correction once and keeps it unsaved for confirmation`          |
| Uninterpretable correction      | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `returns not_interpretable for unrelated messages and does not transition`; `src/interfaces/workers/message.worker.spec.ts` - `sends the ambiguity copy without changing data for an uninterpretable correction` |

Additional Definition of Done coverage:

- Currency correction: `CorrectExpenseUseCase.spec.ts` - `updates currency while preserving the original expense context`.
- Five-cycle limit: `CorrectExpenseUseCase.spec.ts` - `returns cycle_limit when the correction exceeds the maximum cycles`; worker coverage - `sends the cycle-limit copy and does not present another summary`.
- State serialization and validation: `src/domain/value-objects/expense-correction-state.spec.ts`.
- Legacy extraction/review and retry normalization: `src/domain/value-objects/expense-review-payload.spec.ts`, `expense-save-retry-payload.spec.ts`, `expense-clarification-state.spec.ts`, and `RetryExpenseSaveUseCase.spec.ts`.
- Atomic linked-subcategory acceptance/rejection and non-mutation: `CorrectExpenseUseCase.spec.ts`, `ResolveExpenseReviewReplyUseCase.spec.ts`, `ResolveExpenseSummaryActionUseCase.spec.ts`, and `message.worker.spec.ts`.
- Provider schema and contextual prompts: `src/infrastructure/adapters/llm/OpenAIAdapter.spec.ts`, `ClaudeAdapter.spec.ts`, and `NvidiaAdapter.spec.ts`.
- Correction-versus-queue regression: provider, application, and worker tests cover `eran 35 EUR y la categoria es transporte`, `Taxi 12 EUR`, unrelated input, and rejection of correction fields on non-correction intents.
- Inline action and dependency wiring: `src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.spec.ts`, `src/bootstrap/buildDependencies.spec.ts`, and `src/bootstrap/registerWorkers.spec.ts`.
- Correction-entry expiration regression: `ResolveExpenseSummaryActionUseCase.spec.ts` runs the real action resolver, state transition, and category-choice use cases across separate turns for both unknown parents and unknown children, retaining the original deadline without saving the expense or changing the catalog.
- Full worker flow and corrupted-state recovery: `src/interfaces/workers/message.worker.spec.ts`.
- Conversation-level correction safety: `tests/integration/semantic-router-expense-flows.integration.spec.ts` proves the mixed affirmative correction produces a new review, rejects the old binding, performs one correction call, and saves the corrected amount once.

## Related User Stories

- [`E1-US-07 - Correct an erroneous field in natural language`](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-07-correct-an-erroneous-field-in-natural-language/E1-US-07%20%E2%80%94%20Correct%20an%20erroneous%20field%20in%20natural%20language.md)
- [`E1-US-06 - Interpreted expense summary for review`](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-06-interpreted-expense-summary-for-review/E1-US-06%20%E2%80%94%20Interpreted%20expense%20summary%20for%20review.md)
- E1-US-08 for explicit confirmation and spreadsheet persistence.

## Notes

- The correction state is persisted in PostgreSQL alongside the existing conversation FSM; Redis remains the BullMQ broker and is not the source of conversational state.
- The correction flow is channel-agnostic at the application boundary. The current bootstrap uses the Telegram presenter and keeps WhatsApp as a future adapter integration.

## Recovery guidance (2026-11-15)

Correction examples and invalid-subcategory feedback include an explicit cancellation command. Invalid children still preserve the review binding and draft; financial execution claims continue to block exits.

## Expense message formatting (2026-11-16)

Correction prompts separate the question from the examples and the optional cancellation footer. Subcategory errors separate the parent/child explanation from correction instructions. High-amount and correction-limit prompts retain explicit confirmation, with cancellation in its own paragraph. Existing field labels, correction commands, and state/revision guards remain unchanged. See [conversational message formatting](./conversational-message-formatting.md).

## Date validation (2026-11-25)

Date corrections use the same explicit calendar formats and validated receipt time suffixes as [expense review](./expense-summary-review.md). `ayer`, `hoy`, and `mañana` use the current local calendar day, without UTC conversion. An invalid explicit date raises `EXPENSE_DATE_INVALID` before persisting a replacement review, preserving the existing date and draft. The worker presents date-format guidance based on the effective persisted state. Invalid dates no longer silently substitute today.

Date failures during correction never run initial-attempt recovery or emit its resend/reset copy. The retained review and correction-cycle state remain unchanged; cancellation guidance is based on a fresh persisted-state read, with administrator guidance for an unresolved financial claim.
