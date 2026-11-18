# Feature: Account deletion request

## Purpose

Make the account deletion entry discoverable in Telegram settings and require an explicit, time-limited confirmation before any irreversible work.

## Behavior (development implementation)

- The settings menu displays `8. Eliminar cuenta` in development and production. The deletion action is disabled in production until complete erasure is implemented.
- The existing message worker checks the Telegram messaging identity against the internal user ID and acquires the per-user lock before handling the option.
- A development request records `screen: account_deletion` in the existing conversation state with a ten-minute expiry and explains the scope, irreversibility, and preservation of Google Sheets.
- Exact `ELIMINAR MI CUENTA` can start a durable deletion operation in development when the worker has the deletion repository and queue wired. The user receives an initiation notice; a separate worker resumes the operation and sends the completion notice. `cancelar` clears the pending state; expiry asks for a fresh request. Production still reports that deletion is unavailable.
- `/eliminar_cuenta` is a recovery entry to the same confirmation flow when the ordinary settings menu is unreachable. It is routed before OAuth and access approval checks, but after identity matching and lock acquisition. Active incompatible flows receive an unavailable response.
- The development worker attempts Google refresh-token revocation, deletes local active and candidate tokens even if revocation fails, removes user-owned retained BullMQ jobs and Redis keys, then deletes PostgreSQL expenses before their configurations and account row. It never calls a spreadsheet deletion API.
- Completion is sent on a best-effort basis. If Telegram cannot receive it, the account still remains deleted and the temporary operation identity is removed. A remote revocation failure produces separate instructions to remove Gastto from Google account connections.
- New message deduplication markers include a hash of the chat ID to isolate equal message IDs in different chats, plus a temporary owner index for targeted deletion. Legacy markers expire within 24 hours and contain neither a user ID nor a chat ID, so they cannot be attributed safely for individual deletion.
- An account deletion row survives the user row until operational cleanup and notification complete. A recovery scan requeues pending operations. Ingress, message workers and OAuth access check the pending barrier. The webhook admits jobs only for existing identities and serializes queue insertion with barrier creation. Unknown Telegram chats are not processed until a new `/start`, which is an explicit re-registration path; an opaque 48-hour replay marker prevents immediate reuse of the same `/start` delivery.
- The development implementation has component and PostgreSQL/Redis integration tests. It is not yet activated in production because full cross-system race, hosted logging/backup, and restoration checks remain release gates.

## Next implementation phase

Phase 2 must finish its cross-system integration tests and release gates before production activation. Phase 3 will update the frontend privacy policy to match verified behavior.
