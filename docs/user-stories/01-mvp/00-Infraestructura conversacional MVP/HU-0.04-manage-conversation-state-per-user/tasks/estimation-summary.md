# Estimation Summary — HU-0.04

## Total Hours

**16 hours**

## Hours per Task

| Task ID   | Title                                               | Estimated Hours |
| --------- | --------------------------------------------------- | --------------- |
| T-0.04-01 | Implement conversation state Drizzle repository     | 3               |
| T-0.04-02 | Implement state transition application use case     | 2               |
| T-0.04-03 | Implement corrupted state recovery use case         | 2               |
| T-0.04-04 | Implement session timeout worker                    | 3               |
| T-0.04-05 | Wire state management into message pipeline         | 2               |
| T-0.04-06 | Write integration tests for all 5 Gherkin scenarios | 3               |
| T-0.04-07 | Update data model and feature documentation         | 1               |
| **Total** |                                                     | **16**          |

## Coherence Check with Story Points

- **User Story Story Points:** 5
- **Nominal SP range:** 10–20 hours
- **Actual total:** 16 hours
- **Verdict:** Coherent. Falls comfortably within the 5 SP band.

## Estimation Justification

HU-0.04 carries significant architectural weight: it is the central FSM infrastructure used by every subsequent epic. The estimation reflects this by allocating time to:

- **Repository implementation (3h):** Drizzle mapping, atomic transactions, and index-aware queries are non-trivial even though the schema exists.
- **Use cases (4h):** State transitions and corrupted-state recovery must be strictly encapsulated in the Application layer to enforce Clean Architecture boundaries.
- **Timeout worker (3h):** BullMQ repeatable jobs, Redis wiring, and safe failure handling require careful setup.
- **Pipeline wiring (2h):** Refactoring existing direct repository calls in `message.worker.ts` into use-case delegation is mechanical but touches multiple files and tests.
- **Integration tests (3h):** Five Gherkin scenarios against real persistence with mocked external boundaries (LLM, Telegram) demand setup and assertions.
- **Documentation (1h):** Mandatory per project conventions (`AGENTS.md` Ship Check).

The total is at the upper end of the 5 SP range because the HU implements not just the happy-path FSM but also resilience features (corruption recovery, timeout, extensibility) that justify the 5 SP assignment in the original User Story.
