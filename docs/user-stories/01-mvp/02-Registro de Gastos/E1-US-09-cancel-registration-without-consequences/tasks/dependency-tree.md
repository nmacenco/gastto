# Dependency Tree — E1-US-09

## Dependency diagram

```mermaid
flowchart TD
  S[E1-US-05, E1-US-06, E1-US-07<br/>Existing expense-flow states] --> T1[T-E1-US-09-01<br/>Define cancellation contract]
  T1 --> T2[T-E1-US-09-02<br/>Implement context cleanup]
  T1 --> T3[T-E1-US-09-03<br/>Integrate cancellation across states]
  T2 --> T3
  T3 --> T4[T-E1-US-09-04<br/>Wire message boundary]
  T2 --> T5[T-E1-US-09-05<br/>Verify rollback with integration tests]
  T3 --> T5
  T4 --> T5
```

## Critical path

`E1-US-05/E1-US-06/E1-US-07 → T-E1-US-09-01 → T-E1-US-09-02 → T-E1-US-09-03 → T-E1-US-09-04 → T-E1-US-09-05`

Estimated critical-path duration: **11.5 hours**.

## Summary

| Task ID | Title | Depends on | Estimated Hours |
| --- | --- | --- | ---: |
| T-E1-US-09-01 | Define the cancellation contract | E1-US-05, E1-US-06, E1-US-07 | 2 |
| T-E1-US-09-02 | Implement complete conversation-context cleanup | T-E1-US-09-01 | 2.5 |
| T-E1-US-09-03 | Integrate cancellation across expense-flow states | T-E1-US-09-01, T-E1-US-09-02 | 3 |
| T-E1-US-09-04 | Wire the message boundary to the cancellation use case | T-E1-US-09-03 | 1.5 |
| T-E1-US-09-05 | Verify cancellation rollback with integration tests | T-E1-US-09-02, T-E1-US-09-03, T-E1-US-09-04 | 2.5 |
