# Estimation Summary

## HU-0.03 — Send responses to the user

### Total Estimated Hours

**8 hours**

### Hours Distribution per Task

| Task ID   | Title                                                     | Estimated Hours | % of Total |
| --------- | --------------------------------------------------------- | --------------- | ---------- |
| T-0.03-01 | Define messaging output port interface                    | 1               | 12.5%      |
| T-0.03-02 | Implement Telegram HTTP sender adapter                    | 1.5             | 18.75%     |
| T-0.03-03 | Implement retry with exponential backoff and 4xx handling | 1.5             | 18.75%     |
| T-0.03-04 | Implement automatic message chunking for >4096 chars      | 1.5             | 18.75%     |
| T-0.03-05 | Add structured logging for all send operations            | 1               | 12.5%      |
| T-0.03-06 | Write unit tests for sender, retry, chunking, errors      | 1.5             | 18.75%     |
| **Total** |                                                           | **8**           | **100%**   |

### Coherence Check with Story Points

- **User Story Story Points:** 2
- **SP-to-hours guideline:** 2 SP ≈ 4–8 hours
- **Estimated total:** 8 hours

**Result:** ✅ Coherent. The estimation sits at the upper bound of the 2 SP range, which is justified because:

1. The User Story explicitly identifies three non-trivial concerns: retry logic, message splitting, and logging.
2. The retry mechanism requires careful implementation of exponential backoff with fake-timer tests.
3. Message chunking must respect Telegram's 4096-character limit while preserving readability (splitting on sentence/paragraph boundaries).
4. Structured logging must follow the project's observability conventions (`console.error` with structured objects).
5. Unit tests need to cover four distinct scenarios (success, long message, retry, permanent error) using mocked HTTP responses and timer manipulation in Vitest.

No bootstrap task was added because this is HU-0.03 and the runtime scaffold (server, config, DI, base folder structure) is expected to have been established by HU-0.01.

### Justification

The work is purely infrastructural (no domain business rules), but it carries operational complexity. The Telegram Bot API itself is simple (single HTTP POST), yet production-grade reliability requires:

- **Resilience:** Exponential backoff retry for transient failures.
- **Graceful degradation:** Differentiated handling of permanent client errors (400/403).
- **Data integrity:** Automatic splitting of long responses without truncation.
- **Observability:** Structured logs for every send attempt so failures can be diagnosed without user reports.
- **Testability:** Comprehensive unit tests that mock the external API boundary, ensuring the adapter behaves correctly under all error conditions.

These requirements push the effort to the high end of the 2 SP band, but the 8-hour ceiling keeps it within the project's guideline.
