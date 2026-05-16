# Task Dependency Tree

## Visual Dependency Diagram

```
T-0.01-00 (2h)
      |
      |
      v
T-0.01-02 (1h)          T-0.01-01 (1h)
      |                        |
      |                        |
      +-----------+------------+
                  |
          T-0.01-04 (1h)
                  |
                  |        T-0.01-03 (1h)
                  |              |
                  |              |
                  +--------------+------------+
                               |
                         T-0.01-05 (1.5h)
                               |
                               |
                         T-0.01-06 (1h)
```

## Dependency Table

| Task ID   | Title                                                      | Depends On           | Estimated Hours |
| --------- | ---------------------------------------------------------- | -------------------- | --------------- |
| T-0.01-00 | Bootstrap Fastify project skeleton and core infrastructure | None                 | 2               |
| T-0.01-01 | Register Telegram bot with BotFather and secure API token  | None                 | 1               |
| T-0.01-02 | Create Fastify webhook endpoint route and controller       | T-0.01-00            | 1               |
| T-0.01-03 | Implement Telegram source validation middleware            | T-0.01-02            | 1               |
| T-0.01-04 | Configure production webhook via Telegram API              | T-0.01-01, T-0.01-02 | 1               |
| T-0.01-05 | Implement /start command use case and welcome message      | T-0.01-02, T-0.01-03 | 1.5             |
| T-0.01-06 | Verify end-to-end webhook latency and retry behavior       | T-0.01-04, T-0.01-05 | 1               |

## Critical Path

The critical path is the longest chain of dependent tasks that determines the minimum project duration.

**Critical Path:**

```
T-0.01-00 (2h) → T-0.01-02 (1h) → T-0.01-03 (1h) → T-0.01-05 (1.5h) → T-0.01-06 (1h)
```

**Critical Path Duration:** 6.5 hours

**Explanation:**

- T-0.01-00 and T-0.01-01 can start in parallel.
- T-0.01-02 depends on T-0.01-00, so it starts after 2 hours.
- T-0.01-04 depends on both T-0.01-01 (finishes at 1h) and T-0.01-02 (finishes at 3h), so it starts after 3 hours.
- T-0.01-03 depends on T-0.01-02, so it starts after 3 hours.
- T-0.01-05 depends on both T-0.01-02 and T-0.01-03, so it starts after 4 hours.
- T-0.01-06 depends on both T-0.01-04 (finishes at 4h) and T-0.01-05 (finishes at 5.5h), so it starts after 5.5 hours.
- Total duration of the critical path: 6.5 hours.
