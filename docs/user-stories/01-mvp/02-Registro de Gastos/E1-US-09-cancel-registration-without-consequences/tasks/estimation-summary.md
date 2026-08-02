# Estimation Summary — E1-US-09

## Total

**Total estimated effort: 11.5 hours**

## Distribution

| Task ID | Title | Estimated Hours |
| --- | --- | ---: |
| T-E1-US-09-01 | Define the cancellation contract | 2 |
| T-E1-US-09-02 | Implement complete conversation-context cleanup | 2.5 |
| T-E1-US-09-03 | Integrate cancellation across expense-flow states | 3 |
| T-E1-US-09-04 | Wire the message boundary to the cancellation use case | 1.5 |
| T-E1-US-09-05 | Verify cancellation rollback with integration tests | 2.5 |
| **Total** |  | **11.5** |

## Coherence check

The User Story is estimated at **3 Story Points**. The total of **11.5 hours** is within the guideline range of **6–12 hours** for a 3-SP story.

## Justification

The work is more than a single command mapping because cancellation must clear conversational and staged expense state across clarification, summary, correction, and global-command paths. The estimate includes the application contract, persistence cleanup, state-machine integration, transport-boundary wiring, and an integration test proving that no orphaned data survives and that a new expense starts cleanly.
