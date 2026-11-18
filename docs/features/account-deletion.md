# Feature: Account deletion request

## Purpose

Make the account deletion entry discoverable in Telegram settings and require an explicit, time-limited confirmation before any irreversible work.

## Behavior (Phase 1)

- The settings menu displays `8. Eliminar cuenta` in development and production. The deletion action is disabled in production until complete erasure is implemented.
- The existing message worker checks the Telegram messaging identity against the internal user ID and acquires the per-user lock before handling the option.
- A development request records `screen: account_deletion` in the existing conversation state with a ten-minute expiry and explains the scope, irreversibility, and preservation of Google Sheets.
- Exact `ELIMINAR MI CUENTA` consumes the pending confirmation and reports that deletion is not yet available. It does not delete data. `cancelar` also clears the pending state; expiry clears it and asks for a fresh request.
- `/eliminar_cuenta` is a recovery entry to the same confirmation flow when the ordinary settings menu is unreachable. It is routed before OAuth and access approval checks, but after identity matching and lock acquisition. Active incompatible flows receive an unavailable response.
- No Google revocation, PostgreSQL account deletion, Redis job cleanup, or spreadsheet mutation is implemented in Phase 1. Production requests receive an unavailable response and create no pending confirmation.

## Next implementation phase

Phase 2 will replace the unavailable confirmation result with a durable deletion operation and add the lifecycle barrier, revocation, and verified cleanup.
