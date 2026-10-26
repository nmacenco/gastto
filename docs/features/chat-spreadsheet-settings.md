# Feature: Chat spreadsheet settings

## Purpose

Let a user inspect the stored Google or Microsoft connection and current spreadsheet destination from chat.

## Behavior (Implemented)

- The exact `configuración` command opens a numbered menu from `IDLE`. While an expense is active, the user is asked to finish or cancel it first. An unresolved financial execution claim remains protected.
- `1` reports stored credential status (`missing`, `revoked`, or `available`), provider, and selected file and sheet names. An expired access token remains `available` when a non-revoked credential is stored. The message explains that live access was not checked. Incomplete destinations show onboarding guidance.
- `2` starts voluntary Google reauthorization when the current destination has a file and sheet. `3` lists recent Google spreadsheets and starts a file candidate. `4` lists sheets in the current file and starts a sheet candidate. Unknown responses show menu guidance.
- `6` opens the active destination's payment catalog as a local draft. `detectar` reads proposed values from the mapped payment column; manual editing remains available without provider access. An empty confirmation activates configured catalog mode. See [payment methods](./payment-methods.md).
- `5` opens the active destination's category and subcategory hierarchy as a local draft. It works without a Google OAuth request and requires an already configured file and sheet.
- When the destination has no mapped `subcategoria` column, the draft explains that child selections remain local to Gastto and will not be written to the spreadsheet.
- Draft commands add, rename, move, or deactivate hierarchy entries. Child commands require their parent; removing a parent lists its affected children. Every edit refreshes the 30-minute deadline and leaves the active catalog untouched. Typing `configuración` again shows the same draft.
- `confirmar` accepts the complete branch change and saves the hierarchy together with the transition to `IDLE` in one database transaction. The commit checks the current revision, flow, expiry, configuration ownership, active destination, catalog baseline, and absence of a financial execution claim. A stale or conflicting attempt changes no catalog data and asks the user to reopen settings. Database failures retain the draft for retry.
- `cancelar` or expiry discards the draft. An empty active hierarchy cannot be confirmed. Names reserved by another active or inactive identity cannot be used for renames or moves. Adding a deactivated name reactivates its original ID, while reactivating a parent leaves its old children inactive.
- File selection accepts a displayed number, `buscar` followed by a name, a name after the search prompt, or a supported HTTPS Google Sheets or Drive link. Search returns a fresh numbered list. An inaccessible file or a file without sheets remains in file selection. A direct link outside the displayed list uses a generic file label.
- Selecting a file lists its sheets without changing the active configuration. The selected sheet must pass read/write validation. A file change always remaps columns, even when the user says the positions are unchanged; the new file's categories, linked subcategories, and payment methods are read and reviewed before final confirmation.
- A sheet candidate is checked for read/write access. The user answers whether columns keep the same positions; saved positions are reused only when header row metadata and normalized headers agree. Otherwise a new mapping is proposed. Corrections use `campo=número`. The candidate's categories and linked subcategories are then shown for confirmation or editing with `categorías: Nombre; Otra > Subcategoría`.
- Discovery, corrections, and category review change only the owned conversation payload. Final payment confirmation atomically creates a new active configuration with its mappings and both vocabularies and leaves the former version available for historical expenses. Cancellation, expiry, validation failure, and stale responses leave the former version active.
- `cancelar` clears only the owned settings flow to `IDLE`. Accepted messages refresh the 30-minute inactivity deadline. Expiry returns to `IDLE` through a guarded transition, clearing the payload.
- The menu flow holds a random flow ID. No OAuth credential or account email is copied into its payload or status message.
- Google reauthorization creates a 15-minute OAuth nonce and a reminder after 10 minutes. Reminders rotate the nonce even when the old token remains valid. They preserve the original settings deadline and stop at expiry.
- The callback accepts either `code` and `state`, or provider `error` and `state`. Denial, expiry, failed read/write validation, and cancellation leave the old encrypted credential and destination intact. Provider error text is never shown in HTML or chat.
- A successful callback validates the newly exchanged token against the configured file and sheet without saving it first. The encrypted replacement and guarded transition to `IDLE` commit in one database transaction. A stale callback changes neither token nor state. Transient exchange or database failures leave the owned OAuth flow available for retry until its deadline.
- After a guarded exit, cleanup removes only that flow's nonce and reminder. An abandoned callback remains invalid even if external cleanup fails.

## Interface

`GetSpreadsheetSettings.execute({ userId }): Promise<SettingsSummary>` reads stored configuration and credentials without calling a provider. The chat command is handled by the message worker. The existing `/auth/google/callback` route accepts successful authorization and denial with a required `state`; no new route is added.

`SettingsVocabularyFlow.start/reply` manages the owned draft in `SETTINGS_MENU`. `SettingsVocabularyCommit.execute` returns `committed`, `stale`, or `conflict` and performs the catalog and conversation write atomically.

## Data Model

`conversation_states.current_state` permits `SETTINGS_MENU` after migration `0010_add_settings_menu_state`, `SETTINGS_OAUTH` after `0011_add_settings_oauth_state`, sheet review states after `0013_add_settings_sheet_states`, and `SETTINGS_FILE` after `0014_add_settings_file_state`. Migration `0012_friendly_omega_flight` versions configurations. The settings payload contains flow and proposal ownership; `expires_at` contains the deadline. See [data model](../architecture/data-model.md).
