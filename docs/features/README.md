# Features

Canonical documentation for product features. **No `docs/features/<feature>.md` = the feature does not exist.**

Use [`TEMPLATE.md`](./TEMPLATE.md) to create new feature documentation.

## Index

- [`cloud-storage-connection.md`](./cloud-storage-connection.md) — OAuth2 flow for linking Google Drive (MVP) and OneDrive (future).
- [`select-spreadsheet-file.md`](./select-spreadsheet-file.md) — File discovery, search, and selection for spreadsheet records.
- [`select-sheet.md`](./select-sheet.md) — Sheet selection within the chosen spreadsheet file.
- [`validate-spreadsheet-access.md`](./validate-spreadsheet-access.md) — Proactive validation of read/write permissions before expense recording.
- [`infer-and-propose-column-mapping.md`](./infer-and-propose-column-mapping.md) — Rule-based inference engine that analyzes spreadsheet headers and proposes column mappings for Gastto fields.
- [Observability](../architecture/observability.md) — Structured Pino logging across all layers (ADR-013).
