# ADR-030: Commit settings hierarchy drafts transactionally

**Date**: 2026-10-26
**Status**: Accepted
**Deciders**: Product and Engineering

## Context

The onboarding category editor previously persisted each command immediately. Settings must let a user edit the active destination's hierarchy and cancel safely. The category repository previously matched normalized names before supplied UUIDs, so a rename into an inactive row's name could silently replace a stable identity.

## Decision

- Keep the settings hierarchy draft and its full active/inactive baseline in the owned `SETTINGS_MENU` conversation payload. Commands reuse the parent-aware parser and domain aggregate without invoking the immediate-save onboarding use case.
- Preserve known UUIDs on rename and move. Reject names reserved by another active or inactive row. An explicit add of an inactive name reactivates that row's UUID; reactivating a parent leaves former children inactive.
- On confirmation, lock conversation then active configuration, verify the revision, flow, expiry, owner, active destination, baseline, and absence of a financial claim. Write hierarchy rows and clear the conversation to `IDLE` in one transaction. Stale and conflicting attempts change no catalog data.
- Deactivation never rewrites historical expense snapshots or spreadsheet rows.

## Consequences

The draft can be cancelled or expire without changing the active hierarchy. Catalog changes become visible only after confirmation. The active/inactive baseline also detects edits made elsewhere before a settings commit. The conversation payload grows with the hierarchy size; a future size limit may require a dedicated draft table.

## References

- [Chat spreadsheet settings](../features/chat-spreadsheet-settings.md)
- [Subcategory hierarchy](../features/subcategory-hierarchy.md)
- [Data model](../architecture/data-model.md)
