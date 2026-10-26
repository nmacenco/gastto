# ADR-031: Scope payment catalogs to spreadsheet configurations

**Date**: 2026-10-26
**Status**: Accepted
**Deciders**: Product and Engineering

## Context

Expenses previously stored payment methods only as free text. Users need a confirmed catalog without changing historical rows or assuming that a new spreadsheet uses the same methods.

## Decision

- Give every spreadsheet configuration its own flat payment catalog and a nullable confirmation timestamp. A null timestamp preserves legacy free-text behavior; a timestamp with zero active rows is a confirmed empty catalog.
- Reserve normalized names within each configuration and keep stable IDs through renames and soft deactivation. Match only trim plus lowercase; ambiguous or unknown text requires explicit review resolution.
- Keep the saved payment name as an immutable expense snapshot and add a nullable FK. Never backfill historical IDs or rewrite spreadsheet rows.
- Treat explicit addition during expense review as an independent catalog action. Commit it with the revised review and require a new presented binding before saving the expense.
- Review detected payment values after category review for new destinations. Final activation writes the reviewed catalog with mapping, hierarchy, confirmation markers, and conversation exit in one transaction.

## Consequences

Cancellation of an expense does not undo an explicitly added method. A newly selected destination begins with a fresh reviewed catalog. Existing configurations remain in legacy mode until their catalog is confirmed.

## References

- [Payment methods](../features/payment-methods.md)
- [Data model](../architecture/data-model.md)
