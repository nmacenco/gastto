# Estimation Summary — E1-US-07: Correct an erroneous field in natural language

## Total estimated effort

**18 hours**

## Hours per task

| Task ID       | Title                                              | Estimated Hours |
| ------------- | -------------------------------------------------- | --------------- |
| T-E1-US-07-01 | Define correction state value object               | 1               |
| T-E1-US-07-02 | Add LLM correction-interpretation port and prompts | 4               |
| T-E1-US-07-03 | Implement CorrectExpenseUseCase                    | 5               |
| T-E1-US-07-04 | Add correction copies                              | 1               |
| T-E1-US-07-05 | Wire correction flow into message worker           | 3               |
| T-E1-US-07-06 | Document the expense-correction feature            | 1               |
| T-E1-US-07-07 | Write unit and integration tests                   | 3               |
| **Total**     |                                                    | **18**          |

## Coherence check with Story Points

- **User Story Story Points:** 5 SP
- **Nominal 5 SP range:** 10–20 hours
- **Estimated total:** 18 hours
- **Status:** Within range (upper third)

## Justification

The 18-hour estimate reflects real work on a mature foundation where scaffolding already exists but the correction flow is genuinely new:

- **Domain modeling (1h):** The `EXPENSE_CORRECTING` FSM state already exists in `ConversationState.ts`, but has no typed payload. Formalizing `ExpenseCorrectionState` is quick because the shape is already produced by `ResolveExpenseSummaryActionUseCase.handleCorrect()`.
- **LLM correction interpretation (4h):** A dedicated `interpretCorrection` port method plus prompts for three adapters (OpenAI, Claude, Nvidia). This is the main new complexity: relative corrections ("no, fueron 15", "fue ayer") require the current summary as context. The user story explicitly notes the E1-US-03/04 interpretation engine is reusable, so this reuses the existing LLM plumbing rather than building it from scratch.
- **Core use case (5h):** `CorrectExpenseUseCase` is the largest task: applying single/multi-field changes, category normalization via the E1-US-04 classifier, date resolution, high-amount guard, and the 5-cycle limit. Follows the established `RegisterExpenseUseCase` structure, so the orchestration pattern is proven even though the logic is new.
- **Copies (1h):** Small message additions in an existing, well-tested file.
- **Worker wiring (3h):** Adds the missing `EXPENSE_CORRECTING` route and the correction attempt in `EXPENSE_REVIEW` plus DI registration. No business logic, but touches the busiest file in the pipeline.
- **Docs (1h):** One feature doc + index update.
- **Tests (3h):** Six Gherkin scenarios + cycle limit + single-message assertion across unit and integration suites.

No bootstrap task is required: the runtime scaffold (server, FSM, conversation-state repository, Redis, BullMQ worker, LLM adapters, summary presenter) already exists from previous user stories (E1-US-01 through E1-US-06). The 5-SP ceiling is approached but not exceeded because corrections reuse the existing interpretation and summary-presentation machinery rather than adding new infrastructure.
