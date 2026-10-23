# Estimation summary — E1-US-03: Amount and currency detection

## Total estimated effort

**18 hours**

## Hours per task

| Task ID | Title | Estimated hours |
|---|---|---|
| T-E1-US-03-01 | Define Money and Currency value objects | 2 |
| T-E1-US-03-02 | Define extraction result and failure types | 1 |
| T-E1-US-03-03 | Implement extraction service | 5 |
| T-E1-US-03-04 | Default currency fallback via user profile | 2 |
| T-E1-US-03-05 | Clarification request for missing or zero amount | 2 |
| T-E1-US-03-06 | Wire extraction into Telegram pipeline | 3 |
| T-E1-US-03-07 | Write unit tests for extraction service | 3 |
| **Total** | | **18** |

## Coherence check with Story Points

- **User Story Story Points:** 5 SP
- **Guideline range for 5 SP:** 10–20 hours
- **Estimated total:** 18 hours
- **Status:** Within range

## Justification

The 18-hour estimate reflects the real complexity hidden behind "amount detection":

- **Locale parsing (5h):** handling thousands/decimal separators, ISO codes, symbols, and ambiguous `$` requires careful regex/heuristic design and many edge cases.
- **Domain modeling (3h):** introducing `Money`, `Currency`, and extraction result types up-front keeps the rest of the pipeline type-safe.
- **Fallback and clarification (4h):** querying the user profile and mapping each failure mode to the right response is business logic that belongs in the Application layer.
- **Integration (3h):** wiring the use case into the existing Telegram pipeline while keeping the route handler thin.
- **Tests (3h):** reaching ≥ 90% coverage on the extraction function demands a broad test matrix covering regional formats and ambiguous cases.

This distribution stays coherent with the 5 SP assigned to the User Story.
