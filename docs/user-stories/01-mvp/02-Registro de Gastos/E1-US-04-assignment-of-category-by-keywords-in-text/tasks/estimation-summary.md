# Estimation Summary — E1-US-04

## Total estimated effort

**20 hours**

## Hours per task

| Task ID | Title | Estimated Hours |
|---|---|---|
| T-E1-US-04-01 | Define category keyword vocabulary domain value object | 2 |
| T-E1-US-04-02 | Define classification result value object | 1 |
| T-E1-US-04-03 | Define category classifier application ports | 2 |
| T-E1-US-04-04 | Implement keyword-based category classifier | 5 |
| T-E1-US-04-05 | Implement category vocabulary repository adapter | 3 |
| T-E1-US-04-06 | Implement category fallback mapper for unknown categories | 2 |
| T-E1-US-04-07 | Integrate classifier into conversation expense flow | 2 |
| T-E1-US-04-08 | Add unit tests for category classification scenarios | 3 |
| **Total** | | **20** |

## Coherence check with Story Points

- **User Story Story Points:** 5 SP
- **Nominal SP range:** 10–20 hours
- **Estimated total:** 20 hours

The estimate sits at the upper bound of the nominal 5 SP range. This is justified because the story includes building a small classification engine plus several edge cases: ambiguous keywords, no-match handling, and fallback when the inferred category is not in the user's spreadsheet. No bootstrap task is required because the foundational runtime scaffold (server, config, logging, base folder structure) already exists from previous user stories.

## Justification

- The classifier itself (T-E1-US-04-04) receives the largest share (5h) because it centralizes all business logic: tokenization, keyword matching, confidence scoring, ambiguity detection, and fallback orchestration.
- Vocabulary retrieval (T-E1-US-04-05) is medium-sized (3h) because it must integrate with the existing spreadsheet-linking output from E4-US-06 without hard-coupling the use case to that adapter.
- Testing (T-E1-US-04-08) is 3h because the four Gherkin scenarios require meaningful assertions and boundary mocks rather than filler tests.
- Interface integration (T-E1-US-04-07) is kept small (2h) because the handler must only deserialize, validate, and delegate, per the Clean Architecture boundary guardrail.
