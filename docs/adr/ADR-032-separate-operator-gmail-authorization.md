# ADR-032: Separate operator Gmail authorization from product OAuth

**Date**: 2026-11-08
**Status**: Proposed
**Deciders**: Project owner

## Context

Pending Telegram access requests need a low-volume email to the owner from their personal Gmail address. Product users authorize Drive and Sheets; they must not receive Gmail permissions. Google Cloud audience changes do not signal the bot, so a separate local CLI approval remains necessary.

## Considered options

1. **Separate Gmail API OAuth client and grant** — uses only `gmail.send`, with sender/recipient and credentials held as deployment secrets. Requires a durable refresh grant and monitoring.
2. **Gmail SMTP app password** — simpler transport but introduces a broad long-lived account secret.
3. **Third-party sender** — operationally simple, but the sender would need a controlled domain/address rather than the requested personal Gmail identity.

## Decision

Use a separate operator Gmail OAuth client and the Gmail `users.messages.send` endpoint. The adapter uses Node's HTTPS `fetch` with a short timeout and requests only `gmail.send`; it does not add Gmail scopes to product OAuth or store the operator token in the user-token table. Enable the feature only after the owner validates a durable refresh grant for that Google project/account. The deployment CLI approves one current request ID and sends the Telegram notice after commit.

## Consequences

The operator must provision and maintain another OAuth grant. An External/Testing grant may expire after seven days. A Gmail response timeout can leave send outcome ambiguous, so retries are manual and may duplicate an email; the request UUID is stable. A failed email does not discard or approve the request. The decision remains proposed until the external Gmail authorization is validated.

## References

- [Gmail send guide](https://developers.google.com/workspace/gmail/api/guides/sending)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Telegram access approval](../features/telegram-access-approval.md)
