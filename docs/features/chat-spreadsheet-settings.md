# Feature: Chat spreadsheet settings

## Purpose

Let a user inspect the stored Google or Microsoft connection and current spreadsheet destination from chat.

## Behavior (Implemented)

- The exact `configuración` command opens a numbered menu from `IDLE`. While an expense is active, the user is asked to finish or cancel it first. An unresolved financial execution claim remains protected.
- `1` reports stored credential status (`missing`, `revoked`, or `available`), provider, and selected file and sheet names. An expired access token remains `available` when a non-revoked credential is stored. The message explains that live access was not checked. Incomplete destinations show onboarding guidance.
- `2` starts voluntary Google reauthorization when the current destination has a file and sheet. `3` and `4` report that file and sheet changes are coming later. Unknown responses show menu guidance.
- `cancelar` clears only the owned settings flow to `IDLE`. Accepted messages refresh the 30-minute inactivity deadline. Expiry returns to `IDLE` through a guarded transition, clearing the payload.
- The menu flow holds a random flow ID. No OAuth credential or account email is copied into its payload or status message.
- Google reauthorization creates a 15-minute OAuth nonce and a reminder after 10 minutes. Reminders rotate the nonce even when the old token remains valid. They preserve the original settings deadline and stop at expiry.
- The callback accepts either `code` and `state`, or provider `error` and `state`. Denial, expiry, failed read/write validation, and cancellation leave the old encrypted credential and destination intact. Provider error text is never shown in HTML or chat.
- A successful callback validates the newly exchanged token against the configured file and sheet without saving it first. The encrypted replacement and guarded transition to `IDLE` commit in one database transaction. A stale callback changes neither token nor state. Transient exchange or database failures leave the owned OAuth flow available for retry until its deadline.
- After a guarded exit, cleanup removes only that flow's nonce and reminder. An abandoned callback remains invalid even if external cleanup fails.

## Behavior (TODO)

- Phases 3 and 4 of the same plan: safe sheet and spreadsheet changes.

## Interface

`GetSpreadsheetSettings.execute({ userId }): Promise<SettingsSummary>` reads stored configuration and credentials without calling a provider. The chat command is handled by the message worker. The existing `/auth/google/callback` route accepts successful authorization and denial with a required `state`; no new route is added.

## Data Model

`conversation_states.current_state` permits `SETTINGS_MENU` after migration `0010_add_settings_menu_state` and `SETTINGS_OAUTH` after migration `0011_add_settings_oauth_state`. Their `state_payload` contains flow ownership and destination identity; `expires_at` contains the deadline. See [data model](../architecture/data-model.md).
