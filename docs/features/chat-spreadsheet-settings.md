# Feature: Chat spreadsheet settings

## Purpose

Let a user inspect the stored Google or Microsoft connection and current spreadsheet destination from chat.

## Behavior (Implemented)

- The exact `configuración` command opens a numbered menu from `IDLE`. While an expense is active, the user is asked to finish or cancel it first. An unresolved financial execution claim remains protected.
- `1` reports stored credential status (`missing`, `revoked`, or `available`), provider, and selected file and sheet names. An expired access token remains `available` when a non-revoked credential is stored. The message explains that live access was not checked. Incomplete destinations show onboarding guidance.
- `2` starts voluntary Google reauthorization when the current destination has a file and sheet. `4` lists sheets in the current file and prepares a candidate. `3` reports that file changes are coming later. Unknown responses show menu guidance.
- A sheet candidate is checked for read/write access. The user answers whether columns keep the same positions; saved positions are reused only when header row metadata and normalized headers agree. Otherwise a new mapping is proposed. Corrections use `campo=número`. The candidate's categories and linked subcategories are then shown for confirmation or editing with `categorías: Nombre; Otra > Subcategoría`.
- Discovery, corrections, and category review change only the owned conversation payload. Final confirmation atomically creates a new active configuration with its mappings and vocabulary and leaves the former version available for historical expenses. Cancellation, expiry, validation failure, and stale responses leave the former version active.
- `cancelar` clears only the owned settings flow to `IDLE`. Accepted messages refresh the 30-minute inactivity deadline. Expiry returns to `IDLE` through a guarded transition, clearing the payload.
- The menu flow holds a random flow ID. No OAuth credential or account email is copied into its payload or status message.
- Google reauthorization creates a 15-minute OAuth nonce and a reminder after 10 minutes. Reminders rotate the nonce even when the old token remains valid. They preserve the original settings deadline and stop at expiry.
- The callback accepts either `code` and `state`, or provider `error` and `state`. Denial, expiry, failed read/write validation, and cancellation leave the old encrypted credential and destination intact. Provider error text is never shown in HTML or chat.
- A successful callback validates the newly exchanged token against the configured file and sheet without saving it first. The encrypted replacement and guarded transition to `IDLE` commit in one database transaction. A stale callback changes neither token nor state. Transient exchange or database failures leave the owned OAuth flow available for retry until its deadline.
- After a guarded exit, cleanup removes only that flow's nonce and reminder. An abandoned callback remains invalid even if external cleanup fails.

## Behavior (TODO)

- Phase 4 of the same plan: safe spreadsheet file change.

## Interface

`GetSpreadsheetSettings.execute({ userId }): Promise<SettingsSummary>` reads stored configuration and credentials without calling a provider. The chat command is handled by the message worker. The existing `/auth/google/callback` route accepts successful authorization and denial with a required `state`; no new route is added.

## Data Model

`conversation_states.current_state` permits `SETTINGS_MENU` after migration `0010_add_settings_menu_state`, `SETTINGS_OAUTH` after `0011_add_settings_oauth_state`, and sheet review states after `0013_add_settings_sheet_states`. Migration `0012_friendly_omega_flight` versions configurations. The settings payload contains flow and proposal ownership; `expires_at` contains the deadline. See [data model](../architecture/data-model.md).
