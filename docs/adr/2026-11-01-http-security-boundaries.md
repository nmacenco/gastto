# HTTP security boundaries and dependency evidence

Date: 2026-11-01
Status: Accepted for implementation; hosted validation pending

## Context

Unauthenticated webhook attempts and OAuth callbacks previously had no explicit admission budget. Forwarded headers cannot identify clients safely without deployment evidence. Redis is already shared by queue and OAuth state consumers.

## Decision

Authenticate Telegram before parsing. Limit only unauthorized attempts and all OAuth callbacks using atomic Redis counters with expiry. Default budgets: 60 unauthorized attempts and 60 callbacks per 60 seconds per bucket. Hash socket peer addresses into 4096 fixed buckets per route and environment to cap cardinality. Ignore all forwarded headers until an independently verified proxy policy replaces this conservative shared-peer fallback. Collisions and Fly proxy sharing can throttle unrelated callbacks; operators must measure this before promotion. This is not a volumetric DDoS or authenticated-user spending control.

Redis operations have a 250 ms response deadline and at most 16 outstanding operations per limiter instance. Disconnected stores reject without queueing. On store failure, unauthorized Telegram stays 403, OAuth returns 503 before nonce effects, and authenticated Telegram bypasses the limiter. Queue failures retain their existing failure behavior. Counters expire and are never flushed on rollback.

Production Swagger UI and its spec/static routes are not registered. OAuth callback provider must match nonce metadata before token exchange. Encryption keys require 64 hex characters; webhook secrets require Telegram's alphabet and length 32–256. Operators generate secrets from 32 random bytes.

Use Node 24, frozen dependency installs, pinned action SHAs/image digest/tool version and a production audit that fails closed. Exact, owned, approved exceptions expire. Production configuration and external alert delivery require recorded operational evidence.

## Consequences

The fallback favors trustworthy inputs and bounded memory at the cost of shared callback budgets. Limits are configurable, but loosening them requires canary evidence. A short single-secret rotation retry window is accepted; all old Machines must stop auto-registering old secrets. Existing AES ciphertext is unchanged.

## Alternatives

Blanket trustProxy and raw forwarded-header keys permit spoofing. Per-instance maps cannot enforce a shared budget. Unlimited per-address keys allow memory exhaustion. A second Redis client adds lifecycle and queueing complexity; use the existing connection with bounded outstanding work instead.
