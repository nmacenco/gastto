# Dependency Tree — HU-4.05 Infer and Propose Column Mapping

## Task Dependency Graph

```
T-4.05-01 (Domain, 2h) ──────────────────────────────┐
                                                      ├──→ T-4.05-02 (Infra, 5h) ──→ T-4.05-05 (App, 4h) ──→ T-4.05-06 (Interface, 2h)
T-4.05-03 (Infra, 2h) ───────────────────────────────┘         │                                │
                                                                │                                └──→ T-4.05-07 (Cross, 3h)
T-4.05-04 (App, 1h) ───────────────────────────────────────────┘
```

## Critical Path

The longest chain of dependent tasks that determines minimum duration:

**T-4.05-01 → T-4.05-02 → T-4.05-05 → T-4.05-06 → T-4.05-07**

Serial duration: 2 + 5 + 4 + 2 + 3 = **16 hours**

Tasks T-4.05-03 and T-4.05-04 can run in parallel with the critical path before T-4.05-05.

## Summary Table

| Task ID    | Title                                              | Depends on                          | Estimated Hours |
|------------|----------------------------------------------------|-------------------------------------|-----------------|
| T-4.05-01  | Define column inference domain types and port      | None                                | 2               |
| T-4.05-02  | Implement column header inference engine           | T-4.05-01                           | 5               |
| T-4.05-03  | Implement Drizzle column mapping repository        | None                                | 2               |
| T-4.05-04  | Persist spreadsheet preview in ONBOARDING_MAPPING  | None                                | 1               |
| T-4.05-05  | Implement InferColumnMapping use case              | T-4.05-01, T-4.05-02, T-4.05-03, T-4.05-04 | 4        |
| T-4.05-06  | Wire ONBOARDING_MAPPING in message worker          | T-4.05-05                           | 2               |
| T-4.05-07  | Feature doc and remaining tests                    | T-4.05-05, T-4.05-06              | 3               |
| **Total**  |                                                    |                                     | **19**          |
