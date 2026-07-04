# Estimation Summary

## Total Hours

**11.5 hours**

## Hours Distributed Per Task

| Task ID   | Title                                             | Estimated Hours | Layer          |
| --------- | ------------------------------------------------- | --------------- | -------------- |
| T-0.02-01 | Define domain message types and value objects     | 1.5h            | Domain         |
| T-0.02-02 | Implement Telegram payload parser                 | 2.0h            | Infrastructure |
| T-0.02-03 | Implement message router / dispatcher by type     | 1.5h            | Application    |
| T-0.02-04 | Implement unsupported message handler             | 1.0h            | Application    |
| T-0.02-05 | Implement malformed payload handler               | 1.5h            | Interfaces     |
| T-0.02-06 | Implement ordered processing guarantee            | 2.0h            | Infrastructure |
| T-0.02-07 | Write unit tests covering all 4 Gherkin scenarios | 2.0h            | Cross-cutting  |

## Coherence Check with Story Points

- **User Story Story Points:** 3 SP
- **Nominal range for 3 SP:** 6–12 hours
- **Total estimated:** 11.5 hours
- **Status:** ✅ **Coherent** — falls within the expected range.

## Justification

The estimation leans toward the upper end of the 3 SP range because:

1. **Robust error handling** (malformed payloads, unsupported types) requires careful design to avoid leaking exceptions or triggering Telegram retry loops.
2. **Ordered processing** with BullMQ introduces queue infrastructure, worker setup, and integration testing overhead.
3. **Clean Architecture boundary enforcement** adds design rigor — each layer must remain decoupled, which requires explicit ports and disciplined delegation.
4. **Test coverage** for four distinct Gherkin scenarios, including concurrency behavior, is non-trivial and accounts for nearly 20% of the total effort.

This HU is foundational: the parser, router, and queue infrastructure built here will be reused by all subsequent conversation flows, so investing in boundary clarity and test coverage now prevents tech debt later.
