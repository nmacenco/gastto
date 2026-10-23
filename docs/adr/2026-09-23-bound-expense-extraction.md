# ADR-026: Bound expense extraction and recover owned initial attempts

**Date**: 2026-09-23
**Status**: Accepted
**Deciders**: Gastto team

## Context

An expense reached the processing worker but failed about 141 seconds later with `LLM returned empty response`. The observation occurred after acquiring the per-user lease. Increasing lock-contention retries cannot repair a failed provider response. The generic fallback promised a restart without actually resetting the receiving state.

Both NVIDIA and OpenAI previously emitted the same error text, so the supplied logs do not prove which provider failed or why. NVIDIA extraction used a 512-token cap without an application deadline. NVIDIA's GLM-5.3-Flash documentation specifies maximum reasoning by default and separate reasoning/final-answer content. This exposes a compatibility risk for a small structured extraction response budget; it does not prove token exhaustion caused the incident.

## Considered Options

1. Retry the whole BullMQ job: rejected because handlers can already have performed effects or sent messages.
2. Only add a timeout: bounds waiting but leaves poor diagnostics and an unrecovered conversation.
3. Bound provider I/O, classify failures, and recover the owned initial attempt: selected.

## Decision

- All `extractExpense` adapters share typed safe failures, correlation, completion telemetry, and an abortable provider deadline. `LLM_EXTRACTION_TIMEOUT_MS` defaults to 30 seconds, with a 1–60 second configuration range. SDK extraction retries are disabled; correction/chat behavior is outside this deadline's scope.
- Cancellation aborts real transport/body consumption. A rejection race also prevents a non-cooperative transport's late completion from progressing application code. Ownership loss is distinct from provider timeout.
- Initial extraction recovery executes inside the existing application ownership context. Only the captured receiving revision, with no financial claim and no queued-batch marker, can reset to `IDLE`. Clarification, correction, newer drafts, and financial outcomes cannot be discarded by this recovery.
- Only committed recovery produces the dedicated “No guardé este gasto” message. Database failure uses a generic message that does not promise a reset; stale ownership produces no recovery message. The user explicitly resends the expense.
- For the exact NVIDIA model `z-ai/glm-5.3-flash`, extraction requests use documented `reasoning_effort: low` and a bounded 4096-token generation budget instead of the previous 512 tokens. The larger budget is a conservative compatibility adjustment, not a measured optimal value or verified production fix. Other models retain their existing request budget. Only final content is parsed; reasoning is never logged or treated as expense data.
- Spreadsheet persistence still requires review and explicit confirmation.

## Rationale

The boundary reports whether output was empty, truncated, invalid JSON/schema, cancelled, timed out, or failed at the provider. Allowed HTTP status, finish reason, and usage metadata make the next incident actionable without exposing user messages or provider bodies. Compare-and-swap recovery preserves the revision and financial safety guarantees of ADR-024.

## Consequences

### Positive

- Slow extraction no longer occupies a worker indefinitely.
- Failed initial attempts are recoverable by resending the expense.
- Tests cover abort behavior, safe diagnostics, stale ownership, and failed extraction followed by exactly one confirmed write.

### Negative

- The extraction deadline does not bound database queries, queue waiting, category classification, or message delivery.
- The GLM budget can cost more tokens than the previous limit; it remains subject to the same wall-clock deadline.
- A 30-second deadline can reject a healthy but slow provider. Real-provider latency and the model-specific adjustment need development-environment validation.
- Correction and general chat retain existing provider behavior. This change is scoped to extraction.

## References

- [ADR-024](./ADR-024-guard-conversation-writes-and-financial-effects.md)
- [ADR-025](./ADR-025-process-message-lock-contention.md)
- [NVIDIA GLM-5.3-Flash model reference](https://docs.api.nvidia.com/nim/reference/z-ai-glm-5-3-flash)
- [NVIDIA generation request contract](https://docs.api.nvidia.com/nim/reference/z-ai-glm-5-3-flash-infer)
- [Implementation and validation plan](../../ai/plans/2026_09_23-fix_expense_extraction_failures/2026_09_23-fix_expense_extraction_failures-plan.md)
