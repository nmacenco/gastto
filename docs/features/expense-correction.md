# Feature: Expense correction in natural language

## Purpose

Allow a user reviewing an expense summary to correct the amount, currency, category, or date by replying in natural language. The correction is applied to the pending review payload, shown again for confirmation, and is not saved to the spreadsheet until the user explicitly confirms it.

## Behavior (Implemented)

- From `EXPENSE_REVIEW`, a non-confirm and non-cancel text message is interpreted as a correction attempt using the current summary as context.
- The contextual interpretation returns exactly one typed intent: `correction`, `new_expense`, or `unrelated`. A correction is applied to the active review, a genuine new expense is admitted to the FIFO queue, and an unrelated reply leaves both the active payload and queue unchanged.
- Queue admission no longer depends on a lexical correction regular expression. Natural variants such as `eran 35 EUR y la categoria es transporte` reach the correction flow even though they also contain an amount and currency.
- From the inline **Corregir** action, `ResolveExpenseSummaryActionUseCase` creates a typed `ExpenseCorrectionState`, transitions to `EXPENSE_CORRECTING`, and sends examples of natural-language corrections.
- The next message in `EXPENSE_CORRECTING` is interpreted against the stored review payload.
- The correctable fields are:
  - amount (`monto`),
  - currency (`moneda`),
  - category (`categoria`), resolved through the user's active spreadsheet vocabulary, and
  - date (`fecha`), including supported relative values such as `ayer`, `hoy`, and `mañana`.
- Multiple fields in one message are applied atomically and produce one updated summary presentation.
- An unrelated message produces the existing orientation prompt: `¿Querías confirmar, corregir o cancelar el registro?`; it does not transition or save the expense.
- A corrected amount above the user's historical-average threshold is presented with the existing high-amount warning and explicit confirmation prompt. The corrected value remains pending review data until confirmation.
- Correction cycles are counted in `ExpenseCorrectionState`. After five completed cycles, the sixth correction returns the cycle-limit copy and keeps the current correction state instead of presenting another summary.
- Invalid or corrupted correction state is logged with structured context, reset to `IDLE`, and answered with the generic fallback copy.
- Successful corrections reset the review TTL and transition back to `EXPENSE_REVIEW` with the updated payload.

## Behavior (TODO)

- Spreadsheet persistence after explicit confirmation belongs to E1-US-08 and is outside this feature's correction flow.

## API / Interface

No HTTP endpoints are added. The feature is driven by the `process-message` BullMQ worker.

### Application and domain contracts

- `ExpenseCorrectionState`: immutable, validated, JSONB-serializable state with the review payload and correction-cycle counter.
- `LLMPort.interpretCorrection(rawMessage, currentExtracted, userContext)`: provider-neutral follow-up interpretation contract returning `intent: 'correction' | 'new_expense' | 'unrelated'` plus corrected values only for the `correction` branch.
- `CorrectExpenseUseCase.execute(input)`: interprets and applies corrections, returns a typed `new_expense` outcome without mutating the review, resolves categories and dates, enforces high-amount and cycle rules, and transitions the FSM.
- `ResolveExpenseReviewReplyUseCase.execute(input)`: preserves confirm/cancel precedence and delegates only a typed `new_expense` outcome to `QueuePendingExpense`.
- `MessageWorkerDeps.correctExpense`: injected use case used by the worker for both correction entry points.

### Architectural boundary

- The worker deserializes and validates state, delegates to `CorrectExpenseUseCase`, and presents the returned payload.
- `CorrectExpenseUseCase` owns correction business rules and does not depend on Telegram, WhatsApp, or messaging adapters.
- LLM providers are accessed only through `LLMPort`; OpenAI, Claude, and NVIDIA implementations share the strict correction schema and contextual prompt contract.
- Category resolution uses the existing `ICategoryClassifier` port and spreadsheet vocabulary repositories.

## Data Model

- `conversation_states.current_state` uses `EXPENSE_REVIEW` and `EXPENSE_CORRECTING` from the durable FSM.
- `conversation_states.state_payload` stores the review payload or the serialized `ExpenseCorrectionState` JSONB payload.
- No new database table or migration is required.
- `expense_records` is written only by the existing confirmation flow, after explicit confirmation; correction itself does not persist an expense.

## Tests

The E1-US-07 scenarios map to these tests:

| User-story scenario | Covering tests |
| --- | --- |
| Amount correction | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `updates amount when the user corrects it`; `src/interfaces/workers/message.worker.spec.ts` - `applies a direct natural-language correction and presents one updated summary` |
| Category correction | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `updates category through the classifier` |
| Date correction | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `updates date to previous day when the user says "ayer"` |
| Several fields in one message | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `updates multiple fields in a single execution`; `src/interfaces/workers/message.worker.spec.ts` - `presents exactly one updated summary for an atomic multi-field correction` |
| Unusually high corrected amount | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `requests explicit confirmation for unusually high corrected amounts`; `src/interfaces/workers/message.worker.spec.ts` - `presents a high-amount correction once and keeps it unsaved for confirmation` |
| Uninterpretable correction | `src/application/use-cases/expense/CorrectExpenseUseCase.spec.ts` - `returns not_interpretable for unrelated messages and does not transition`; `src/interfaces/workers/message.worker.spec.ts` - `sends the ambiguity copy without changing data for an uninterpretable correction` |

Additional Definition of Done coverage:

- Currency correction: `CorrectExpenseUseCase.spec.ts` - `updates currency while preserving the original expense context`.
- Five-cycle limit: `CorrectExpenseUseCase.spec.ts` - `returns cycle_limit when the correction exceeds the maximum cycles`; worker coverage - `sends the cycle-limit copy and does not present another summary`.
- State serialization and validation: `src/domain/value-objects/expense-correction-state.spec.ts`.
- Provider schema and contextual prompts: `src/infrastructure/adapters/llm/OpenAIAdapter.spec.ts`, `ClaudeAdapter.spec.ts`, and `NvidiaAdapter.spec.ts`.
- Correction-versus-queue regression: provider, application, and worker tests cover `eran 35 EUR y la categoria es transporte`, `Taxi 12 EUR`, unrelated input, and rejection of correction fields on non-correction intents.
- Inline action and dependency wiring: `src/application/use-cases/expense/ResolveExpenseSummaryActionUseCase.spec.ts`, `src/bootstrap/buildDependencies.spec.ts`, and `src/bootstrap/registerWorkers.spec.ts`.
- Full worker flow and corrupted-state recovery: `src/interfaces/workers/message.worker.spec.ts`.

## Related User Stories

- [`E1-US-07 - Correct an erroneous field in natural language`](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-07-correct-an-erroneous-field-in-natural-language/E1-US-07%20%E2%80%94%20Correct%20an%20erroneous%20field%20in%20natural%20language.md)
- [`E1-US-06 - Interpreted expense summary for review`](../user-stories/01-mvp/02-Registro%20de%20Gastos/E1-US-06-interpreted-expense-summary-for-review/E1-US-06%20%E2%80%94%20Interpreted%20expense%20summary%20for%20review.md)
- E1-US-08 for explicit confirmation and spreadsheet persistence.

## Notes

- The correction state is persisted in PostgreSQL alongside the existing conversation FSM; Redis remains the BullMQ broker and is not the source of conversational state.
- The correction flow is channel-agnostic at the application boundary. The current bootstrap uses the Telegram presenter and keeps WhatsApp as a future adapter integration.
