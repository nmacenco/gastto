# Estimation Summary — E1-US-08: Confirm expense registration with a minimal response

## Total estimated effort

**8 hours**

## Hours per task

| Task ID | Title | Estimated Hours |
| --- | --- | ---: |
| T-E1-US-08-01 | Define and test the fixed confirmation vocabulary | 1.5 |
| T-E1-US-08-02 | Implement application-level expense review reply resolution | 2.5 |
| T-E1-US-08-03 | Wire minimal replies into the expense review worker | 1.5 |
| T-E1-US-08-04 | Cover confirmation, correction, and ambiguity scenarios with tests | 1.5 |
| T-E1-US-08-05 | Document the expense confirmation feature | 1 |
| **Total** |  | **8** |

## Coherence check with Story Points

- **User Story Story Points:** 2 SP
- **Nominal 2 SP range:** 4–8 hours
- **Estimated total:** 8 hours
- **Status:** Within range (upper bound)

## Justification

The estimate assumes the existing E1-US-06 summary, E1-US-07 correction flow, FSM, worker pipeline, messaging port, and save contract are available. The main work is a small fixed-vocabulary extension plus an application-level classifier/orchestrator that must distinguish minimal confirmations from correction text. Worker wiring is limited to dependency injection and delegation, while tests cover the four Gherkin scenarios at the application and worker boundaries. The final hour keeps the canonical feature documentation and feature index synchronized. No database migration or bootstrap work is required.

