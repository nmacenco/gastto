# Features

Canonical documentation for product features. **No `docs/features/<feature>.md` = the feature does not exist.**

Use [`TEMPLATE.md`](./TEMPLATE.md) to create new feature documentation.

## Index

- [`cloud-storage-connection.md`](./cloud-storage-connection.md) — OAuth2 flow for linking Google Drive (MVP) and OneDrive (future).
- [`select-spreadsheet-file.md`](./select-spreadsheet-file.md) — File discovery, search, and selection for spreadsheet records.
- [`select-sheet.md`](./select-sheet.md) — Sheet selection within the chosen spreadsheet file.
- [`validate-spreadsheet-access.md`](./validate-spreadsheet-access.md) — Proactive validation of read/write permissions before expense recording.
- [`infer-and-propose-column-mapping.md`](./infer-and-propose-column-mapping.md) — Rule-based + LLM hybrid inference engine that detects header rows and proposes column mappings for Gastto fields.
- [`confirm-or-correct-column-mapping.md`](./confirm-or-correct-column-mapping.md) — User confirmation, natural-language correction, and LLM re-inference on rejection, with Redis-backed transient state.
- [`category-confirmation.md`](./category-confirmation.md) — Reads the existing category vocabulary from the spreadsheet and presents it for confirmation.
- [`incoming-message-routing.md`](./incoming-message-routing.md) — Webhook ingestion, payload parsing, and channel-agnostic routing of Telegram messages.
- [`send-responses-to-user.md`](./send-responses-to-user.md) — Channel-agnostic message delivery with retry, chunking, and failure classification.
- [`conversation-state-management.md`](./conversation-state-management.md) — PostgreSQL-backed FSM for multi-turn conversational flows with session timeout.
- [`deployment.md`](./deployment.md) — Multi-environment Fly.io deployment, secrets management, and Telegram bot isolation.
- [Observability](../architecture/observability.md) — Structured Pino logging across all layers (ADR-013).
