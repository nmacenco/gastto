# Dependency Tree — HU-4.04

## Task Dependency Graph

```
T-4.04-01 (Domain port & value objects)
├── T-4.04-02 (Google Sheets adapter) ──────┐
├── T-4.04-03 (Excel Online adapter) ───────┤
└── T-4.04-04 (Use case) ──────────────────┤
                                             │
T-4.04-02 ──────────────────────────────────┤
T-4.04-03 ──────────────────────────────────┤
T-4.04-04 ──────────────────────────────────┤
                                             ▼
                                    T-4.04-05 (Handler)
                                             │
                                             ▼
                                    T-4.04-06 (QA & docs)
```

## Parallel Execution Opportunities

- **T-4.04-02**, **T-4.04-03**, and **T-4.04-04** can all begin as soon as T-4.04-01 is complete. They are independent of each other and can be worked on in parallel by different developers.
- T-4.04-05 is the integration point — it blocks until all three parallel tasks finish.

## Critical Path

The critical path (longest chain of dependent tasks determining minimum duration):

```
T-4.04-01 (1.5h) → T-4.04-02 (2.5h) → T-4.04-05 (2.0h) → T-4.04-06 (1.0h)
```

**Critical path duration: 7.0 hours**

Note: T-4.04-03 and T-4.04-04 run in parallel with T-4.04-02 on the critical path, so they do not extend the minimum duration.

## Summary Table

| Task ID | Title | Depends on | Estimated Hours |
|---|---|---|---|
| T-4.04-01 | Define spreadsheet access domain port and value objects | None | 1.5 |
| T-4.04-02 | Implement Google Sheets preview and write-permission adapter | T-4.04-01 | 2.5 |
| T-4.04-03 | Implement Excel Online preview and write-permission adapter | T-4.04-01 | 2.5 |
| T-4.04-04 | Implement validate spreadsheet access use case | T-4.04-01 | 2.5 |
| T-4.04-05 | Wire conversation handler to validate access | T-4.04-02, T-4.04-03, T-4.04-04 | 2.0 |
| T-4.04-06 | QA scenarios and feature documentation update | T-4.04-05 | 1.0 |
