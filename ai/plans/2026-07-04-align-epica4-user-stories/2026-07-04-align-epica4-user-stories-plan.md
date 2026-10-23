# Align Épica 4 user stories with MVP scope

## Goal

Align the Épica 4 user stories with the MVP feature documentation: mark OneDrive as out-of-scope, remove Portuguese expectations, fix ambiguous and self-contradictory scenarios, and establish the consolidated Spanish file as the canonical source of truth.

## Context

- **Canonical user-story file:** `docs/user-stories/01-mvp/01-Vinculacion de planilla · Release 1 MVP/Epica 4 - historias de usuario en un solo archivo.md`
- **English per-HU files:** `docs/user-stories/01-mvp/01-Vinculacion de planilla · Release 1 MVP/HU-4.0X-*/HU-4.0X — *.md`
- **Summary file:** `docs/user-stories/01-mvp/01-Vinculacion de planilla · Release 1 MVP/Resumen epica.md`
- **Feature docs to cross-check:**
  - `docs/features/cloud-storage-connection.md`
  - `docs/features/select-spreadsheet-file.md`
  - `docs/features/select-sheet.md`
  - `docs/features/validate-spreadsheet-access.md`
- **Project conventions:** `AGENTS.md`, `docs/plans/plan-conventions.md`

The consolidated Spanish file is the canonical source. The individual English files are translations generated from it.

## Phases

### Phase 1 - Align user stories and sync English translations

- [x] **Pre-edit inventory:** Read the canonical Spanish file and each English per-HU file, and list the exact diffs per HU (OneDrive mentions, Portuguese text, ambiguous scenarios, broken links). This prevents assumptions about what is already in sync before editing.
- [x] Update **HU-4.01**:
  - Mark OneDrive as "proximamente" / out of MVP in the onboarding option.
  - Remove or relabel the OneDrive successful-authorization scenario as future work.
  - Add a retry cap to the OAuth reminder scenario (propose **3 attempts** as the default; confirm with the user if a different value is preferred before writing it into the HU). _Resolved: user chose to cap at 3 in the HU and add a TODO in `cloud-storage-connection.md` (reminder reschedules indefinitely today)._
  - Add an invalid-provider-choice scenario.
  - Update the Definition of Done to reflect Google-Drive-only MVP scope.
- [x] Update **HU-4.02**:
  - Scope file search to Google Drive only.
  - Add the "manual name search yields no results" edge case. _Cross-check: confirmed implemented in `HandleSpreadsheetFileSelection.ts` (`noFilesFoundPrompt`); documented in `select-spreadsheet-file.md`._
- [x] Update **HU-4.03**:
  - Clarify that sheet-name matching is whitespace-insensitive in addition to case/accent-insensitive. _Cross-check: matches `select-sheet.md` normalization (lowercase, NFD unaccented, whitespace collapsed)._
- [x] Update **HU-4.04**:
  - Reword the empty-sheet scenario to state that creating a structure from scratch is not available in the MVP and offer to choose another sheet or abort. _Cross-check: aligns with `validate-spreadsheet-access.md` out-of-MVP message._
- [x] Update **HU-4.05**:
  - Replace `Importe` with a genuinely ambiguous header (e.g., `Campo2`). Before writing it, confirm it does not collide with headers used in existing spreadsheet examples, feature docs, or test fixtures elsewhere in the repo (search `docs/features/`, tests, and fixtures). _Done: `Campo2` (ES) / `Col2` (EN); no collisions found._
  - ~~Remove Portuguese from the multi-language scenario; keep Spanish and English as MVP scope.~~ _Reverted during cross-check: `infer-and-propose-column-mapping.md` documents Portuguese as implemented (ES/EN/PT synonym dictionaries, passing tests). HU kept as Spanish/English/Portuguese to match implemented behavior (user decision)._
- [x] Update **HU-4.06**:
  - ~~Disambiguate finalization words for the correction loop (`listo`, `termine`, `confirmo`) so they do not clash with `ok` as acknowledgement.~~ _Reverted during cross-check: `intents.ts` treats `ok`, `listo`, and `confirmo` all as confirm intents that finalize the mapping; there is no "ok as acknowledgement" concept and `terminé` is not a confirm word. HU kept aligned to implemented behavior (user decision)._
- [x] Sync all changes into the individual **English per-HU files**.
- [x] Update **Resumen epica.md** links from Obsidian wikilinks to standard Markdown relative links. (Adjacent polish; keep only if the user wants it — otherwise defer to a separate cleanup.)
- [x] **Feature-doc cross-check:** Compare the updated HUs against `docs/features/cloud-storage-connection.md`, `select-spreadsheet-file.md`, `select-sheet.md`, `validate-spreadsheet-access.md`, plus `infer-and-propose-column-mapping.md` and `confirm-or-correct-column-mapping.md` (added after discovering they exist). Outcomes: retry-cap TODO added to `cloud-storage-connection.md`; empty-search behavior documented in `select-spreadsheet-file.md`; HU-4.05 Portuguese and HU-4.06 finalization-words changes reverted to match implemented behavior.
- [x] Run `pnpm lint`, `pnpm typecheck`, and `pnpm format:check` to verify the repo stays green (markdown changes can affect formatting checks even when code is untouched). _All three pass green._
- [x] Ask the user if they want to review the changes before continuing.

## Public contracts

- **Text copies / chat messages:** Acceptance criteria describe user-facing bot messages; these requirements will be updated to match the implemented MVP behavior.

## Next step

Phase 1 complete. No further phases remain. Suggest exporting the conversation as `ai/plans/2026-07-04-align-epica4-user-stories/2026-07-04-align-epica4-user-stories-conversation.md`.
