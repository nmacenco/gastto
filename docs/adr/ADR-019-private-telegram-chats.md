# ADR-019: Restrict Telegram Ingestion to Private Chats

**Date**: 2026-08-17
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

Telegram updates can originate from private chats, groups, supergroups, and channels. Processing a non-private update could create a local identity, expose acknowledgements in a shared conversation, and ingest financial data outside the intended one-user boundary.

The webhook secret verifies Telegram as the sender, but it does not establish that the update belongs to a private user conversation.

## Considered Options

1. **Accept every authenticated chat type**
   - Pros: Supports group use without additional routing logic.
   - Cons: Creates identities and conversational side effects in shared chats.

2. **Reject non-private updates with an HTTP error**
   - Pros: Makes unsupported chat types explicit to Telegram.
   - Cons: Causes unnecessary retry traffic for intentionally ignored updates.

3. **Acknowledge authenticated non-private updates without processing them**
   - Pros: Preserves Telegram delivery behavior while preventing identity, queue, message, and state side effects.
   - Cons: Group support requires an explicit future product and security decision.

## Decision

Telegram ingestion is restricted to updates whose message or callback-query message has `chat.type = 'private'`.

The route validates the Telegram secret in Fastify's `onRequest` lifecycle hook, before body parsing and validation. After authentication, group, supergroup, channel, and unclassified chat updates return `{ ok: true }` with HTTP 200 and stop before payload normalization or any downstream side effect.

Malformed updates structurally identified as private continue to return HTTP 200 to prevent retry loops and emit only operational metadata in their error log.

## Rationale

- A Telegram chat ID represents the intended one-user identity boundary only in a private chat.
- `onRequest` rejects unauthenticated traffic before allocating work to parse or validate a request body.
- Acknowledging ignored, authenticated updates prevents retries without enabling shared-chat behavior implicitly.

## Consequences

### Positive

- No users, jobs, acknowledgements, or conversation transitions are created from group, supergroup, or channel updates.
- The webhook origin and chat-scope trust boundaries are explicit and independently testable.
- Existing private-chat routing behavior and Telegram retry prevention remain intact.

### Negative

- The bot intentionally performs no action when added to a Telegram group or channel.
- Future group support requires a new ADR, identity model, and interaction design.

## References

- [ADR-005: Decouple Latency with BullMQ over Redis](./ADR-005-bullmq-redis.md)
- [ADR-008: Use Local User Registration with Internal UUID](./ADR-008-user-identity.md)
- [ADR-009: Use Persistent Node.js Server with Fastify](./ADR-009-fastify-persistent.md)
- [ADR-011: Two-Queue Pipeline for FIFO Message Ordering](./ADR-011-two-stage-pipeline.md)
- [Incoming message routing](../features/incoming-message-routing.md)
