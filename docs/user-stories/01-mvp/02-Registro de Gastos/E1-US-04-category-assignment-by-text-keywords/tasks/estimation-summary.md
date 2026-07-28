# Estimation Summary — E1-US-04: Category assignment by text keywords

## Total hours: 11.0 hours

## Distribution per task

| Task ID | Title | Estimated Hours |
|---|---|---|
| T-E1-US-04-01 | Define category and keyword vocabulary domain model | 2.0 |
| T-E1-US-04-02 | Implement keyword-based category classifier service | 2.5 |
| T-E1-US-04-03 | Create output port and adapter for user's spreadsheet vocabulary | 2.0 |
| T-E1-US-04-04 | Wire category assignment into the expense interpretation flow | 2.0 |
| T-E1-US-04-05 | Add unit tests for all classification scenarios | 2.5 |
| **Total** | | **11.0** |

## Coherence check with Story Points

- User Story Story Points: **5**
- Expected range for 5 SP: **10–20 hours**
- Estimated total: **11 hours** ✅ Within range

## Justification

- **No bootstrap task needed** — the project scaffold (Fastify server, Drizzle DB, Telegram webhook, interpretation use case) is already being built in E1-US-01 through E1-US-03.
- The classifier is heuristic-based (keyword matching, not LLM), keeping complexity moderate.
- The 6 base categories (food, transportation, housing, health, entertainment, services) with Spanish keywords cover the MVP scope.
- Integration with the user's spreadsheet vocabulary (E4-US-06) adds a port/adapter layer and a mapping heuristic, reflected in T-03's 2h estimate.
- Testing coverage is the largest single item at 2.5h because all five Gherkin scenarios need explicit unit tests plus edge cases (confidence boundaries, missing vocabulary, non-blocking low-confidence flow).
- The sequential dependency chain means no parallelization — all 11h are on the critical path.
