# ADR-028: Bound expense extraction fallback across providers

**Date**: 2026-10-21
**Status**: Accepted
**Deciders**: Gastto team

## Context

Two consecutive NVIDIA expense requests exhausted the 60-second extraction deadline
while awaiting HTTP response headers. Changing a model or API key within the same
provider need not change its network route or gateway availability. The existing
recovery safely returned the conversation to `IDLE`, but the user had to resend
the same expense and no alternate provider was attempted.

The application already has independent NVIDIA, Anthropic, and OpenAI adapters.
The extraction deadline must remain bounded, and provider failures must never
authorize a spreadsheet write.

## Considered Options

1. Keep manual resending after every provider failure. This is safe but does not
   restore service when the selected provider is unavailable.
2. Retry the same provider. This can repeat a gateway or network stall and add
   load without changing the failure domain.
3. Try one independently keyed provider within the existing extraction deadline.
   This can recover a provider-specific failure while bounding user wait and cost.

## Decision

Use option 3 for initial expense extraction. Keep the existing primary selection
and add `LLM_FALLBACK_PROVIDER`. Its `auto` default picks one configured provider
different from the primary, preferring OpenAI, Anthropic, then NVIDIA. `none`
disables fallback; an explicit provider requires its key and must differ from the
primary. With only one configured key, extraction remains single-provider.

Allocate half of the configured extraction deadline to the primary and the
remaining wall-clock time to the backup. Retry only typed extraction failures.
Caller cancellation and unexpected application errors do not start another call.
Pass the original user message and correlation ID to both attempts. Validate the
backup output with the same schema, and preserve review and explicit save
confirmation. Correction and other LLM-port operations retain the primary.

## Rationale

The observed `awaiting_headers` phase proves only that no response headers reached
the adapter before timeout; it does not identify provider generation, queuing, or
network delay. A different provider changes the external failure domain without
claiming that the original provider is defective. A shared deadline prevents two
sequential 60-second waits.

## Consequences

### Positive

- A configured backup can complete an expense extraction when the primary fails.
- Each provider's existing safe error classification and transport cancellation
  remain in force.
- No fallback path can write an expense before the user's review and confirmation.

### Negative

- A failed primary call may still incur provider usage before the backup call.
- The primary receives less time when a backup exists; a healthy slow response may
  be replaced by the backup.
- A non-cooperative transport may continue work after cancellation; the application
  ignores its late result, but external usage cannot be ruled out.
- A second provider key and development validation are required for actual
  cross-provider recovery.

## References

- [ADR-026](./2026-09-23-bound-expense-extraction.md)
- [ADR-027](./2026-10-09-stream-nvidia-expense-extraction.md)
- [Expense summary review](../features/expense-summary-review.md)
