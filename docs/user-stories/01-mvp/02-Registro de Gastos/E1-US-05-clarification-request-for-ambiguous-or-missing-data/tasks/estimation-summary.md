# Estimation Summary — E1-US-05: Clarification request for ambiguous or missing data

## Total estimated effort

**19 hours**

## Hours per task

| Task ID | Title | Estimated Hours |
|---|---|---|
| T-E1-US-05-01 | Define clarification state payload domain types | 1 |
| T-E1-US-05-02 | Implement single-missing-field clarification trigger | 3 |
| T-E1-US-05-03 | Handle user response to clarification | 3 |
| T-E1-US-05-04 | Handle interruption — new expense during clarification | 3 |
| T-E1-US-05-05 | Handle invalid response with reformulation | 2 |
| T-E1-US-05-06 | Add interruption and reformulation copies | 1 |
| T-E1-US-05-07 | Wire clarification flow into Telegram pipeline | 3 |
| T-E1-US-05-08 | Write integration tests for all scenarios | 3 |
| **Total** | | **19** |

## Coherence check with Story Points

- **User Story Story Points:** 5 SP
- **Nominal 5 SP range:** 10–20 hours
- **Estimated total:** 19 hours
- **Status:** Within range (upper bound)

## Justification

The 19-hour estimate reflects the actual state of the codebase where ~90% of the clarification flow is already implemented:

- **Domain modeling (1h):** The `ExpenseClarificationState` value object formalizes an already-existing implicit shape. Minimal effort because the fields are already defined in `transitionToClarifying()`.
- **Core flow (6h):** Tasks T-E1-US-05-02 and T-E1-US-05-03 are largely verification and hardening of existing logic in `RegisterExpense.ts` and `message.worker.ts`. The sequential missing-field scenario (amount then currency) is the main untested edge case.
- **New features (6h):** Tasks T-E1-US-05-04 (interruption) and T-E1-US-05-05 (invalid response) are the only genuinely new pieces of business logic. The interruption heuristic and the reformulation-with-options are non-trivial but scoped.
- **Copies (1h):** Simple message string additions, minimal effort.
- **Integration (3h):** Verifying the end-to-end pipeline through the worker with no business logic leaks. Mostly verification, not new code.
- **Tests (3h):** Missing the interruption integration test (DoD requirement) and the reformulation test. Existing test suite covers ~4 of 6 scenarios.

No bootstrap task is required because the foundational runtime scaffold (server, FSM, conversation state repository, Redis, BullMQ worker) already exists from previous user stories (E1-US-01 through E1-US-04).
