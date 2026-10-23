# ADR-022: Store Linked Subcategories with Stable References and Snapshots

**Date**: 2026-09-03
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

Gastto currently stores a flat category vocabulary per spreadsheet and preserves only the selected category text on a saved expense. Release 2 introduces subcategories that must belong to a category, permits the same normalized subcategory name under different parents, and requires category and subcategory selections to remain auditable after vocabulary changes.

The storage foundation must be deployable before any onboarding, classification, correction, or spreadsheet-writing consumer starts using subcategories. Existing category-only spreadsheets and expense rows must remain valid, and historical data must not be guessed or destructively backfilled.

## Considered Options

1. **Store subcategories as JSON inside `user_categories`**
   - Pros: No additional child table or join.
   - Cons: Parent-scoped uniqueness, foreign keys, indexes, usage counters, and independent lifecycle operations become difficult to enforce.

2. **Store a flat subcategory table keyed only by spreadsheet**
   - Pros: Similar to the current category vocabulary and simple to query.
   - Cons: The database cannot require a parent relationship or allow the same normalized name safely under different categories.

3. **Store subcategories in a child table and retain nullable expense references plus text snapshots**
   - Pros: Enforces a required parent and parent-scoped uniqueness, supports indexed lookups, preserves stable identifiers, and keeps historical display text independent from vocabulary lifecycle changes.
   - Cons: Requires transactional hierarchy persistence and additional joins when consumers load the complete vocabulary.

## Decision

We chose **a separate `user_subcategories` child table with nullable expense references and immutable text snapshots**.

- Every subcategory has a stable UUID and a required `category_id` referencing `user_categories.id` with `ON DELETE CASCADE`.
- `(category_id, normalized_value)` is unique. Equal normalized subcategory names are valid under different categories.
- Categories and subcategories use `is_active` for normal vocabulary removal. Aggregate persistence will update the hierarchy transactionally so partial branches are never exposed.
- `expense_records.category_id` and `expense_records.subcategory_id` are nullable foreign keys with `ON DELETE SET NULL`.
- `expense_records.categoria` remains the category text snapshot, and nullable `expense_records.subcategoria` stores the subcategory text snapshot.
- Snapshot values are not rewritten by later vocabulary renames, deactivation, moves, or hard deletion.
- Existing expenses receive null references and a null subcategory snapshot. No fuzzy, inferred, or destructive historical backfill is performed.
- The migration is additive and is deployed before any runtime consumer starts persisting or reading linked subcategories.

## Rationale

- A required foreign key makes orphan configured subcategories impossible at the persistence boundary.
- Parent-scoped uniqueness matches the user-story rule without imposing global name uniqueness.
- Stable references support future classification, correction, and analytics, while snapshots preserve the exact text confirmed at save time.
- Nullable references and additive columns preserve compatibility with every existing expense row and category-only flow.
- Explicit cascade and set-null actions make deletion behavior deterministic and testable.

## Consequences

### Positive

- The database enforces hierarchy integrity and duplicate scope.
- Hard-deleting a category removes its configured children without erasing expense history.
- Historical category and subcategory labels remain stable even when vocabulary rows change or disappear.
- The foundation can be rolled out independently before later feature phases.

### Negative

- Hierarchy saves require a transaction spanning category and subcategory mutations.
- Loading a complete vocabulary requires reading both parent and child rows.
- References alone cannot enforce that an expense's `subcategory_id` belongs to its optional `category_id`; domain and repository code must persist selections from one validated aggregate.

## References

- [`HU-4.08 - Configure linked categories and subcategories`](../user-stories/02-release-2-producto-complejo/02-epica-4/HU-4.08%20%E2%80%94%20Configure%20linked%20categories%20and%20subcategories.md)
- [`E1-US-18 - Classify and register linked subcategories`](../user-stories/02-release-2-producto-complejo/01-epica-1/E1-US-18%20%E2%80%94%20Classify%20and%20register%20linked%20subcategories.md)
- [`ADR-006: Implement Write-with-Confirmation and Retry for Save Reliability`](./ADR-006-write-confirmation.md)
- [`Data Model`](../architecture/data-model.md)
