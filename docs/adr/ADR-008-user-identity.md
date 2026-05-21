# ADR-008: Use Local User Registration with Internal UUID

**Date**: 2025-04
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

Gastto receives messages through external messaging channels (Telegram and WhatsApp Business API). Each channel provides its own conversation identifier: Telegram uses a numeric `chat_id`; WhatsApp uses the user's phone number. However, depending on these external identifiers as the user's primary key introduces significant friction at medium term:

- The same user might interact with Gastto from Telegram and WhatsApp, generating two disconnected identities with the same spreadsheet and history.
- If a new channel is added in the future (webchat, own mobile app, web frontend), the system would need to migrate all records associated with the previous external identifier.
- OAuth tokens (ADR-007), column mappings (ADR-004), and conversational state (ADR-003) are stored in PostgreSQL and already implicitly reference an internal `userId`. Without an explicit `User` entity, these references float without a stable anchor.

An explicit decision is needed on how user identity is modeled in the system before drafting the first user stories, since it directly affects the database schema and identity resolution logic in the Messaging Gateway.

## Considered Options

1. **Use Telegram `chat_id` as primary key**
   - Pros: Simple, no additional lookup.
   - Cons: Not portable between channels. A single user on Telegram and WhatsApp would generate two disconnected records with duplicate configurations. Prevents future multi-channel support without structural migration.

2. **Use phone number as primary key**
   - Pros: Conceptually links Telegram and WhatsApp.
   - Cons: Assumes Telegram and WhatsApp share the same number, which is not guaranteed (business accounts, different numbers per channel). Also exposes personal data as a technical key.

3. **No explicit `User` entity**
   - Pros: Simpler initial schema.
   - Cons: ADRs 003, 004, 006, and 007 already reference an implicit `userId`. Not formalizing the entity leaves those references unanchored, generating schema inconsistencies and hindering auditing.

4. **Local `User` entity with internal UUID and separate messaging identities**
   - Pros: Stable across channel changes, enables multi-channel linking, consistent with existing ADRs.
   - Cons: Adds an extra lookup query in the Gateway per incoming message. Adds two tables to the schema.

## Decision

Every Gastto user has a **local PostgreSQL record** represented by a `User` entity with an internally generated UUID `userId`, created by the system on first contact.

**Data model:**

```typescript
// Main entity
User {
  userId: UUID          // internal primary identifier, system-generated
  createdAt: timestamp
  status: 'active' | 'onboarding' | 'suspended'
}

// Messaging identities (1:N relationship with User)
MessagingIdentity {
  id: UUID
  userId: UUID          // FK → User.userId
  channel: 'telegram' | 'whatsapp'
  externalId: string    // Telegram chat_id or WhatsApp E.164 number
  linkedAt: timestamp
}
```

**Identity resolution in the Gateway:** When a webhook arrives, the Gateway extracts `channel` and `externalId` from the incoming message, queries the `MessagingIdentity` table for the corresponding `userId`, and passes it to the Orchestrator. If no `MessagingIdentity` exists for that `(channel, externalId)` pair, the system creates a new `User` and a new linked `MessagingIdentity`, initiating the onboarding flow.

## Rationale

- The internal `userId` is stable against channel changes, phone number changes, or new messaging channel additions.
- Separation between messaging identity and system identity enables a single user to link multiple channels in the future without data migration.
- Consistent with existing ADRs: State (ADR-003), Spreadsheet (ADR-004), and Security (ADR-007) modules already operate over an internal `userId`; this ADR formalizes it.
- If a proprietary frontend (web or mobile) with email/password or SSO authentication is added in the future, a new `MessagingIdentity` of type `'web'` associated with the same `userId` suffices. No structural refactoring needed.
- Facilitates auditing and support: all records for a user (state, mapping, tokens, expenses) can be recovered from a single `userId`.

## Consequences

### Positive

- Stable `userId` against channel, phone number, or new messaging channel changes.
- Multi-channel linking without data migration.
- Consistency with existing ADRs that already reference an internal `userId`.
- Future frontend additions require only a new `MessagingIdentity` record.
- Facilitates auditing and support from a single identifier.

### Negative

- Adds an extra query in the Gateway per incoming message (MessagingIdentity lookup). Mitigation: cache the `(channel, externalId) → userId` resolution in Redis (Upstash) with a reasonable TTL (24h), sharing the same Redis instance that BullMQ uses as broker (ADR-005).
- Adds two tables to the database schema (`users`, `messaging_identities`) that must be managed from the first sprint, though their logic is simple.
- Onboarding must consider the case of a user already existing in another `MessagingIdentity` (same phone, different channel). For the MVP this case is out of scope: each `(channel, externalId)` generates an independent `User`. Cross-channel account linking is deferred to the Backlog.

## References

- [`docs/adr/ADR-003-fsm-postgresql.md`](./ADR-003-fsm-postgresql.md)
- [`docs/adr/ADR-004-spreadsheet-adapter.md`](./ADR-004-spreadsheet-adapter.md)
- [`docs/adr/ADR-005-bullmq-redis.md`](./ADR-005-bullmq-redis.md)
- [`docs/adr/ADR-007-oauth-aes256.md`](./ADR-007-oauth-aes256.md)
