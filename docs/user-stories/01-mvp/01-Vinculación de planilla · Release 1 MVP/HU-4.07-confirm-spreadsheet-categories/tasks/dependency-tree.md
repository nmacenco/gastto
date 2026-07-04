# Dependency Tree — HU-4.07

## Task relationships

```text
T-4.07-01 (Domain model)
├── T-4.07-02 (Application ports)
│   ├── T-4.07-03 (Spreadsheet reader)
│   │   └── T-4.07-05 (Detect/present use case)
│   │       ├── T-4.07-06 (Confirm use case)
│   │       │   └── T-4.07-09 (Telegram handler)
│   │       └── T-4.07-07 (Add/correct use case)
│   │           └── T-4.07-09 (Telegram handler)
│   └── T-4.07-08 (Redis state adapter)
│       └── T-4.07-09 (Telegram handler)
└── T-4.07-04 (NL parser)
    └── T-4.07-07 (Add/correct use case)

T-4.07-10 (Tests)
├── T-4.07-04
├── T-4.07-05
├── T-4.07-06
└── T-4.07-07
```

## Critical path

`T-4.07-01 → T-4.07-02 → T-4.07-05 → T-4.07-07 → T-4.07-09`

This is the longest chain (6.5 hours) and determines the minimum time to deliver the full feature. The confirm-only path (`T-4.07-01 → T-4.07-02 → T-4.07-05 → T-4.07-06 → T-4.07-09`) is shorter.

## Summary table

| Task ID | Title | Depends on | Estimated Hours |
|---|---|---|---|
| T-4.07-01 | Define domain model for category vocabulary | None | 1 |
| T-4.07-02 | Define application ports for category vocabulary persistence | T-4.07-01 | 1 |
| T-4.07-03 | Implement spreadsheet unique category values reader | T-4.07-02 | 1.5 |
| T-4.07-04 | Implement natural-language category edit parser | T-4.07-01 | 2 |
| T-4.07-05 | Implement detect and present categories use case | T-4.07-02, T-4.07-03 | 1.5 |
| T-4.07-06 | Implement confirm categories use case | T-4.07-02, T-4.07-05 | 1 |
| T-4.07-07 | Implement add or correct category use case | T-4.07-02, T-4.07-04, T-4.07-05 | 1 |
| T-4.07-08 | Implement Redis conversation state adapter for category confirmation flow | T-4.07-02 | 1 |
| T-4.07-09 | Implement Telegram handler for category confirmation messages | T-4.07-06, T-4.07-07, T-4.07-08 | 2 |
| T-4.07-10 | Add unit tests for category vocabulary use cases and parser | T-4.07-04, T-4.07-05, T-4.07-06, T-4.07-07 | 1 |
