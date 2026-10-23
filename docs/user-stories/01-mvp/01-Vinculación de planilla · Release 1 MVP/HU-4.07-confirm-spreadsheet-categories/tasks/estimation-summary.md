# Estimation Summary — HU-4.07

## Total hours

**10 hours**

## Hours distributed per task

| Task ID | Title | Estimated Hours |
|---------|-------|-----------------|
| T-4.07-01 | Read unique category values from spreadsheet | 1.5 |
| T-4.07-02 | Define category vocabulary domain model | 0.5 |
| T-4.07-03 | Implement category vocabulary repository and schema | 1.5 |
| T-4.07-04 | Implement detect-and-present categories use case | 1.5 |
| T-4.07-05 | Implement confirm categories use case | 1.0 |
| T-4.07-06 | Implement add and correct categories via natural language use case | 1.5 |
| T-4.07-07 | Implement Telegram conversation handlers for category confirmation | 1.5 |
| T-4.07-08 | Write integration tests and QA coverage | 1.5 |
| **Total** | | **10.0** |

## Coherence check with Story Points

- **User Story Story Points:** 3
- **Nominal hour range for 3 SP:** 6 – 12 hours
- **Total estimated hours:** 10 hours
- **Status:** ✅ Within range

## Justification

The main complexity drivers are:

1. **Spreadsheet integration (T-4.07-01, 1.5h):** Efficiently reading and deduplicating category values from an external sheet requires careful adapter design and pagination handling.
2. **Natural-language intent parsing (T-4.07-06, 1.5h):** Interpreting user commands to add or rename categories is the core business-logic challenge. It may involve an LLM call or a robust rule-based parser, both requiring thorough unit testing with multiple Spanish/English variations.
3. **Cross-layer orchestration (T-4.07-04, 1.5h):** The detect-and-present use case coordinates the adapter, domain model, repository, and default-set logic, making it a nontrivial integration point.

The remaining tasks are standard Clean Architecture scaffolding (Domain model, Repository, Confirm use case, Telegram handlers, Tests) with well-understood patterns already established in previous HUs. The 10-hour total fits comfortably within the 3 SP range and reflects realistic effort for a single developer working through the stack without hidden bootstrap work.
