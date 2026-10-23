# Estimation summary — E1-US-06: Interpreted expense summary for review

## Total estimated effort

**12 hours**

## Hours per task

| Task ID | Title | Estimated hours |
|---|---|---|
| T-E1-US-06-01 | Define expense summary output port and DTO | 1 |
| T-E1-US-06-02 | Implement expense summary formatting with confidence markers | 2 |
| T-E1-US-06-03 | Implement high-amount detection and warning | 1 |
| T-E1-US-06-04 | Implement timeout, reminder, and auto-cancel flow | 2 |
| T-E1-US-06-05 | Wire summary presentation into Telegram pipeline | 2 |
| T-E1-US-06-06 | Implement confirm/correct/cancel action resolution | 1 |
| T-E1-US-06-07 | Write unit and integration tests | 3 |
| **Total** | | **12** |

## Coherence check with Story Points

- **User Story Story Points:** 3 SP
- **Guideline range for 3 SP:** 6–12 hours
- **Estimated total:** 12 hours
- **Status:** Within range (upper bound)

## Justification

The 12-hour estimate aligns with the 3 SP assigned. The distribution reflects:

- **Output port and DTO (1h):** straightforward interface definition following existing patterns.
- **Core formatting (2h):** combining the five fields, default values, and confidence markers into a structured DTO — the central piece but not overly complex.
- **High-amount warning (1h):** simple comparison against historical average; no new infrastructure.
- **Timeout/reminder flow (2h):** the main complexity per the US description — requires interaction with the existing conversation state machine, two timers, and auto-cancel cleanup.
- **Telegram wiring (2h):** implementing the presenter adapter with markdown formatting, inline buttons, and updating the handler.
- **Action resolution (1h):** routing Confirm/Correct/Cancel callbacks to downstream use cases.
- **Tests (3h):** comprehensive coverage of all five Gherkin scenarios plus timeout logic, including integration tests for the Telegram adapter.

The estimate assumes that E1-US-03/04/05 (interpretation layer) and HU-0.04 (conversation state) are already completed, so this US focuses purely on presentation and timeout management.
