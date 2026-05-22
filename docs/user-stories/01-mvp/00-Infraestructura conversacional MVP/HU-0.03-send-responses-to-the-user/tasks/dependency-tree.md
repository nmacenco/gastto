# Task Dependency Tree

## HU-0.03 — Send responses to the user

### Dependency Diagram

```
T-0.03-01 (Application port)
│
├─► T-0.03-02 (Telegram HTTP adapter)
│   │
│   ├─► T-0.03-03 (Retry & 4xx handling)
│   │   │
│   │   └─► T-0.03-05 (Structured logging)
│   │
│   └─► T-0.03-04 (Message chunking)
│       │
│       └─► T-0.03-05 (Structured logging)
│
└─► T-0.03-06 (Unit tests)
    │
    └─ depends on T-0.03-03, T-0.03-04, T-0.03-05
```

### Sequential Order

1. **T-0.03-01** — Define messaging output port interface  
   → No dependencies. Establishes the Clean Architecture boundary.

2. **T-0.03-02** — Implement Telegram HTTP sender adapter  
   → Depends on **T-0.03-01**.

3. **T-0.03-03** — Implement retry with exponential backoff and 4xx handling  
   → Depends on **T-0.03-02**.

4. **T-0.03-04** — Implement automatic message chunking for >4096 characters  
   → Depends on **T-0.03-02**. Can run in parallel with T-0.03-03.

5. **T-0.03-05** — Add structured logging for all send operations  
   → Depends on **T-0.03-03** and **T-0.03-04**.

6. **T-0.03-06** — Write unit tests for sender, retry, chunking, and error handling  
   → Depends on **T-0.03-03**, **T-0.03-04**, and **T-0.03-05**.

### Critical Path

The longest chain of dependent tasks is:

```
T-0.03-01 → T-0.03-02 → T-0.03-03 → T-0.03-05 → T-0.03-06
```

Duration: **1 + 1.5 + 1.5 + 1 + 1.5 = 6.5 hours**

Parallel work (T-0.03-04) adds no extra time to the critical path because it completes before T-0.03-05 starts.

### Summary Table

| Task ID   | Title                                                     | Depends on                      | Estimated Hours |
| --------- | --------------------------------------------------------- | ------------------------------- | --------------- |
| T-0.03-01 | Define messaging output port interface                    | None                            | 1               |
| T-0.03-02 | Implement Telegram HTTP sender adapter                    | T-0.03-01                       | 1.5             |
| T-0.03-03 | Implement retry with exponential backoff and 4xx handling | T-0.03-02                       | 1.5             |
| T-0.03-04 | Implement automatic message chunking for >4096 chars      | T-0.03-02                       | 1.5             |
| T-0.03-05 | Add structured logging for all send operations            | T-0.03-03, T-0.03-04            | 1               |
| T-0.03-06 | Write unit tests for sender, retry, chunking, errors      | T-0.03-03, T-0.03-04, T-0.03-05 | 1.5             |
| **Total** |                                                           |                                 | **8**           |
