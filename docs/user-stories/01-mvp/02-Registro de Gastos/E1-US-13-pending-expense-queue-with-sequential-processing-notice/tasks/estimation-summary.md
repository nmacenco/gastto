# Estimation summary — E1-US-13

**Total estimated effort:** 32 hours

| Task ID | Estimated hours |
| --- | ---: |
| T-E1-US-13-01 | 3 |
| T-E1-US-13-02 | 5 |
| T-E1-US-13-03 | 6 |
| T-E1-US-13-04 | 4 |
| T-E1-US-13-05 | 4 |
| T-E1-US-13-06 | 5 |
| T-E1-US-13-07 | 5 |
| **Total** | **32** |

## Story-point coherence

The story is estimated at **8 Story Points**. The project guide places 8 SP in a 16–32 hour range; 32 hours is coherent at the upper bound because this change introduces durable FIFO state and modifies the interaction of routing, confirmation, cancellation, correction, timeout, and undo across two messaging channels.

The estimate deliberately reserves integration and documentation work: the story's value is consistent end-to-end behavior rather than an isolated queue data structure. Tasks T-E1-US-13-04, T-E1-US-13-05, and T-E1-US-13-06 can be completed in parallel after the shared orchestration is available.
