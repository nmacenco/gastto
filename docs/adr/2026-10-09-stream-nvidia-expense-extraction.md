# ADR-027: Stream NVIDIA GLM expense extraction

**Date**: 2026-10-09
**Status**: Accepted
**Deciders**: Gastto team

## Context

Two user-reported expense attempts with `z-ai/glm-5.3-flash` reached the configured 60-second deadline without HTTP response headers. The later request was 3369 bytes and timed out in `awaiting_headers`. A successful test in NVIDIA's console confirms the model is available but does not reproduce the application's full request or its deployment network. The incident does not establish whether generation, queuing, or network delay caused the timeout.

The existing request used `stream: false`. NVIDIA documents an SSE response when `stream: true`, with partial deltas and a final `[DONE]` marker. GLM separates reasoning from final-answer content.

## Considered Options

1. Increase the extraction deadline again: the configured maximum is already 60 seconds and this would leave the cause obscure.
2. Switch providers or models: this changes extraction quality and requires separate validation.
3. Stream only GLM extraction: allows earlier response/progress signals while preserving the provider choice and the existing deadline.

## Decision

For the exact `z-ai/glm-5.3-flash` extraction profile, request SSE and assemble only final-answer deltas. Ignore reasoning text, require the stream completion marker, preserve finish-reason and usage handling, and apply the existing JSON/schema validation after completion. Keep the 60-second maximum deadline across the whole request and stream. Other NVIDIA models retain their JSON response path.

Log the HTTP phase, first event latency, and event counts without logging prompt, reasoning, or final-answer text. Bound the event and accumulated answer sizes.

## Rationale

Streaming can reveal whether headers and tokens arrive before the deadline, and it may avoid waiting for the full non-streaming response before the application sees any progress. It does not guarantee the model completes within 60 seconds. A continued `awaiting_headers` timeout points toward request/network/provider waiting before SSE begins; a `streaming_body` timeout shows that the response started but did not complete in time.

## Consequences

### Positive

- Provider progress is observable without exposing private message or reasoning content.
- The existing review, validation, cancellation, and recovery rules remain in force.

### Negative

- The adapter now parses SSE for one model profile and must handle incomplete streams.
- A model that spends more than the deadline generating still times out and needs a separate provider/profile decision.

## References

- [ADR-026](./2026-09-23-bound-expense-extraction.md)
- [NVIDIA GLM-5.3-Flash inference contract](https://docs.api.nvidia.com/nim/reference/z-ai-glm-5-3-flash-infer)
- [NVIDIA GLM-5.3-Flash model reference](https://docs.api.nvidia.com/nim/reference/z-ai-glm-5-3-flash)
