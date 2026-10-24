# ADR-029 · Version spreadsheet destinations for safe settings changes

**Status:** Accepted

## Context

ADR-015 used `ON CONFLICT (user_id) DO UPDATE` to make re-onboarding idempotent. An expense stores a `spreadsheet_id`, sheet, and row. Overwriting the file or sheet of that configuration can make undo target a row in a different file. A settings change also needs to survive cancellation, provider errors, and races without changing the active destination.

## Decision

- Keep every confirmed destination as a distinct `spreadsheet_configs` row. `is_active` is true for the single current row and false for history. A partial unique index on `user_id WHERE is_active = true` enforces at most one active row.
- Discovery and review keep a flow ID, source configuration ID, proposal ID, mapping, and category hierarchy in the guarded conversation payload. They do not write the active configuration or its mappings and categories.
- Final activation locks the conversation and active configuration, verifies revision, state, expiry, flow and proposal identity, and absence of a financial claim, then inserts an inactive candidate, its mapping and categories, deactivates the old row, activates the new row, and clears the FSM in one transaction.
- Undo resolves the configuration referenced by the expense's `spreadsheet_id`. A missing or inaccessible historical file fails safely and never falls back to the active file.
- First onboarding creates or resumes only an incomplete initial configuration. A completed user's new destination must use settings activation. Old `ON CONFLICT (user_id)` writers must be stopped before the partial-index migration is deployed.

This decision supersedes ADR-015's destination-overwrite upsert. Its BullMQ single-attempt and persistence-before-message decisions remain valid.

## Consequences

Historical rows, mappings, and categories remain available for expenses and undo. Activation takes an extra transaction and requires coordinated migration-before-worker rollout. Provider access to old files may still be lost; undo reports that failure without choosing a substitute destination.
