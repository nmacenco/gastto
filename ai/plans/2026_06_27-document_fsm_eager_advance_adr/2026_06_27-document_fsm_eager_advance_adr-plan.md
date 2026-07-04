# Plan: Document FSM eager advance as an ADR

## Goal

Document the FSM eager-advance pattern as an Architecture Decision Record so the team has a single source of truth for when and how a use case can automatically trigger the next use case on deterministic FSM transitions.

## Context

- Gastto's chat is modeled as a persisted FSM (ADR-003). Several forward transitions do not require user input, yet the system historically waited for the next incoming message before running the next use case.
- The OAuth callback already auto-triggers `HandleSpreadsheetFileSelection` and the file-selection use case already auto-triggers `HandleSheetSelection`, but the pattern is not documented or applied consistently.
- Remaining onboarding candidates where eager advance should apply:
  - `ONBOARDING_SHEET` → `ONBOARDING_VALIDATING_ACCESS` after single-sheet auto-confirmation.
  - `ONBOARDING_VALIDATING_ACCESS` → `ONBOARDING_MAPPING` after successful access validation.
- Expense-flow candidates where eager advance should apply:
  - `EXPENSE_REVIEW` → `EXPENSE_SAVING` after the user confirms the expense.
  - `EXPENSE_SAVING` → `IDLE` after a successful save (to send the final confirmation).
- Transitions that must **not** use eager advance because they require user input or confirmation:
  - `ONBOARDING_FILE` self-transition while the user is choosing from the file list.
  - `ONBOARDING_SHEET` self-transition while the user is choosing from the sheet list.
  - `ONBOARDING_VALIDATING_ACCESS` → `ONBOARDING_SHEET` on empty-sheet confirmation.
  - `ONBOARDING_VALIDATING_ACCESS` → `ONBOARDING_START` on access error.
  - `ONBOARDING_MAPPING` self-transition while the user reviews the proposed column mapping.
  - `ONBOARDING_CATEGORIES` self-transition while the user reviews categories.
  - `EXPENSE_RECEIVING` → `EXPENSE_CLARIFYING` when the expense needs clarification.
  - `EXPENSE_REVIEW` → `EXPENSE_CORRECTING` when the user asks to correct a field.
- Relevant prior ADRs:
  - `docs/adr/adr.md`: ADR index and format.
  - `docs/adr/adr.md#adr-003`: FSM persisted in PostgreSQL.
  - `docs/adr/adr.md#adr-005`: asynchronous BullMQ pipeline.
- Files involved:
  - `docs/adr/ADR-014-fsm-eager-advance.md` (new ADR)
  - `docs/adr/README.md` (index update)
  - `docs/adr/adr.md` (legacy index update)
  - `docs/architecture/fsm-states.md` (cross-reference)

## Phases

### Phase 1: Draft the ADR

Description: Write the ADR following the existing format in `docs/adr/adr.md`. Define the context, decision, when to apply/not apply the pattern, examples across onboarding and expense flows, and consequences.

Public contracts modified:
- New ADR file `docs/adr/ADR-014-fsm-eager-advance.md`.
- ADR index in `docs/adr/README.md` and `docs/adr/adr.md`.

- [x] Create a new ADR under `docs/adr/` (final slug: `ADR-014-fsm-eager-advance.md`).
- [x] Include sections: Context, Decision, When to apply, When not to apply, Consequences, and Relation to other ADRs.
- [x] List concrete examples of all current and future eager-advance transitions in onboarding and expense flows.
- [x] Update `docs/adr/README.md` and `docs/adr/adr.md` to add the new ADR to the indexes with a short description and link.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify nothing breaks.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Cross-reference in FSM documentation

Description: Update `docs/architecture/fsm-states.md` to reference the eager-advance ADR in the state table notes, so agents working on FSM transitions know the pattern exists.

Public contracts modified:
- Text / documented behavior in `docs/architecture/fsm-states.md`.

- [x] Add a note in `docs/architecture/fsm-states.md` explaining that deterministic forward transitions may auto-trigger the next use case, per the eager-advance ADR.
- [x] Verify no other docs (features, user-stories, ADRs) need updating for this documentation change.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify nothing breaks.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. Review the changes and commit them, or export the conversation and save it alongside the plan.
