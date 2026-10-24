# Feature: Chat spreadsheet settings

## Purpose

Let a user inspect the stored Google or Microsoft connection and current spreadsheet destination from chat.

## Behavior (Implemented)

- The exact `configuración` command opens a numbered menu from `IDLE`. While an expense is active, the user is asked to finish or cancel it first. An unresolved financial execution claim remains protected.
- `1` reports stored credential status (`missing`, `revoked`, or `available`), provider, and selected file and sheet names. An expired access token remains `available` when a non-revoked credential is stored. The message explains that live access was not checked. Incomplete destinations show onboarding guidance.
- `2`, `3`, and `4` report that reauthorization, file change, and sheet change are coming later. Unknown responses show menu guidance.
- `cancelar` clears only the owned settings flow to `IDLE`. Accepted messages refresh the 30-minute inactivity deadline. Expiry returns to `IDLE` through a guarded transition, clearing the payload.
- The menu flow holds a random flow ID. No OAuth credential or account email is copied into its payload or status message.

## Behavior (TODO)

- Phase 2 of `ai/plans/2026_10_23-chat_spreadsheet_settings/2026_10_23-chat_spreadsheet_settings-plan.md`: Google reauthorization.
- Phases 3 and 4 of the same plan: safe sheet and spreadsheet changes.

## Interface

`GetSpreadsheetSettings.execute({ userId }): Promise<SettingsSummary>` reads stored configuration and credentials without calling a provider. The chat command is handled by the message worker; no new HTTP route is added.

## Data Model

`conversation_states.current_state` permits `SETTINGS_MENU` after migration `0010_add_settings_menu_state`. Its `state_payload` contains the flow ID and `expires_at` contains the deadline. See [data model](../architecture/data-model.md).
