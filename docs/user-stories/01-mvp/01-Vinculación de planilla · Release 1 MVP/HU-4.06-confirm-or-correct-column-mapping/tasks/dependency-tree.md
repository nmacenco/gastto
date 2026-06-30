# Dependency Tree — HU-4.06

## Task relationships

```text
T-4.06-01 (Domain model)
├── T-4.06-02 (Application ports)
│   ├── T-4.06-03 (Confirm use case)
│   │   └── T-4.06-07 (Telegram handler)
│   ├── T-4.06-05 (Correct field use case)
│   │   ├── T-4.06-07 (Telegram handler)
│   │   └── T-4.06-08 (Tests)
│   └── T-4.06-06 (Redis state adapter)
│       └── T-4.06-07 (Telegram handler)
└── T-4.06-04 (NL parser)
    └── T-4.06-05 (Correct field use case)
```

## Critical path

`T-4.06-01 → T-4.06-02 → T-4.06-05 → T-4.06-07`

This is the longest chain (6.5 hours) and determines the minimum time to deliver the full feature. The confirm-only path (`T-4.06-01 → T-4.06-02 → T-4.06-03 → T-4.06-07`) is shorter.

## Summary table

| Task ID | Title | Depends on | Estimated Hours |
|---|---|---|---|
| T-4.06-01 | Define domain model for column mapping confirmation and correction state | None | 1 |
| T-4.06-02 | Define application ports for mapping persistence and column listing | T-4.06-01 | 1 |
| T-4.06-03 | Implement confirm column mapping use case | T-4.06-02 | 1.5 |
| T-4.06-04 | Implement natural-language correction parser | T-4.06-01 | 2 |
| T-4.06-05 | Implement correct single mapping field use case with column validation | T-4.06-02, T-4.06-04 | 2 |
| T-4.06-06 | Implement Redis conversation state for mapping correction flow | T-4.06-02 | 1.5 |
| T-4.06-07 | Implement Telegram handler for confirmation and correction messages | T-4.06-03, T-4.06-05, T-4.06-06 | 2 |
| T-4.06-08 | Add unit tests for use cases and validation logic | T-4.06-03, T-4.06-05 | 1 |
