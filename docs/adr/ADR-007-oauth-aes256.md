# ADR-007: Encrypt OAuth Tokens at Rest with AES-256

**Date**: 2025-04
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead, Security Reviewer

## Context

Gastto acts on behalf of the user over their personal files in Google Drive and OneDrive. To do so, it stores OAuth 2.0 access and refresh tokens for both providers. These tokens are high-value credentials: their exposure would allow an attacker to access the user's files and potentially other services from the same provider. Secure management is a non-negotiable requirement.

## Considered Options

1. **Plaintext storage in database**
   - Pros: Simplest to implement, no encryption overhead.
   - Cons: Direct credential exposure in any database dump or unauthorized access. Unacceptable.

2. **Storage in Redis**
   - Pros: Fast access.
   - Cons: Redis does not offer encryption at rest by default. Additionally, Redis restarts and tokens would be lost, forcing frequent re-authentication.

3. **Storage in process environment variables**
   - Pros: No database writes for tokens.
   - Cons: Does not scale to multiple users. Environment variables are per-process, not per-user.

4. **AES-256 encryption at rest in database with transparent refresh**
   - Pros: Secure, scalable, aligns with OAuth 2.0 guidelines.
   - Cons: Requires secure key management.

## Decision

Implement an **encrypted token storage strategy** with the following guarantees:

- **Encryption at rest:** Access and refresh tokens are stored encrypted in the database using **AES-256**. They are never persisted in plaintext.
- **No exposure:** The token is never included in logs, API responses, user messages, or application environment variables. The encryption key is managed as an infrastructure secret (Fly.io environment variable or external secret manager).
- **Transparent refresh:** If the access token expires during an operation, the system transparently uses the refresh token to obtain a new one, without interrupting the user or requiring re-authentication.
- **Explicit revocation:** If the system detects an `AUTH_ERROR` (HTTP 401/403) that is not resolved by the refresh token, it concludes permissions were revoked by the user and notifies them requesting re-authentication (coordinated with ADR-006).

## Rationale

- Protects credentials against database breaches: a dump without the AES key is useless.
- Transparent refresh improves UX: the flow is not interrupted by token expiration.
- Alignment with Google and Microsoft OAuth 2.0 security guidelines.

## Consequences

### Positive

- Protects credentials against database breaches.
- Transparent refresh improves user experience.
- Alignment with OAuth 2.0 security guidelines.

### Negative

- Requires secure AES-256 key management: if the key is compromised, all stored tokens are exposed. Periodic key rotation with re-encryption is recommended.
- Dual OAuth integration (Google + Microsoft) doubles the authentication surface and security test cases from the MVP.
- Adds complexity to the onboarding flow: each provider has its own OAuth consent flow with different scopes.

## References

- [`docs/adr/ADR-006-write-confirmation.md`](./ADR-006-write-confirmation.md)
- [`docs/architecture/security-permissions.md`](../architecture/security-permissions.md)
