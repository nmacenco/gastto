# Features

Canonical documentation for product features. **No `docs/features/<feature>.md` = the feature does not exist.**

Use [`TEMPLATE.md`](./TEMPLATE.md) to create new feature documentation.

## Index

- [`cloud-storage-connection.md`](./cloud-storage-connection.md) — OAuth2 flow for linking Google Drive (MVP) and OneDrive (future).
- [`select-spreadsheet-file.md`](./select-spreadsheet-file.md) — File discovery, search, and selection for spreadsheet records.
- [`select-sheet.md`](./select-sheet.md) — Sheet selection within the chosen spreadsheet file.
- [`validate-spreadsheet-access.md`](./validate-spreadsheet-access.md) — Proactive validation of read/write permissions before expense recording.
- [`infer-and-propose-column-mapping.md`](./infer-and-propose-column-mapping.md) — Rule-based + LLM hybrid inference engine with untrusted spreadsheet-data boundaries that detects header rows and proposes column mappings for Gastto fields.
- [`confirm-or-correct-column-mapping.md`](./confirm-or-correct-column-mapping.md) — User confirmation and one-field-per-message natural-language correction, including previously unmapped fields, final correction persistence, multi-field rejection, and Redis-backed transient state.
- [`category-confirmation.md`](./category-confirmation.md) — Reads the existing category vocabulary from the spreadsheet and presents it for confirmation.
- [`incoming-message-routing.md`](./incoming-message-routing.md) — Private-chat-only Telegram ingestion with strict BullMQ payload validation and channel-agnostic routing.
- [`clarification-request.md`](./clarification-request.md) — Single-question clarification flow for missing or ambiguous expense amount/currency data.
- [`expense-summary-review.md`](./expense-summary-review.md) — Structured interpreted-expense summary with confirm / correct / cancel options before saving.
- [`expense-cancellation.md`](./expense-cancellation.md) — Global safe cancellation of in-progress expense registrations.
- [`expense-correction.md`](./expense-correction.md) — Natural-language correction of amount, currency, category, or date before expense confirmation.
- [`expense-confirmation.md`](./expense-confirmation.md) — Confirmation with correction-safe precedence, safe Google Sheets cell writes, save-location confirmation, and contextual save-failure recovery including Google reauthorization.
- [`undo-last-expense.md`](./undo-last-expense.md) — Safe one-record Google Sheets undo with immediate eligibility and delayed explicit confirmation.
- [`send-responses-to-user.md`](./send-responses-to-user.md) — Channel-agnostic message delivery with retry, chunking, and failure classification.
- [`conversation-state-management.md`](./conversation-state-management.md) — PostgreSQL-backed FSM with complete onboarding timeout exits and contextual spreadsheet-reconnection transitions.
- [`deployment.md`](./deployment.md) — Merge-protected multi-environment Fly.io deployment with provider-independent Redis-compatible brokers, persistent BullMQ worker Machines, secure cutover and rollback, graceful shutdown, and Telegram bot isolation.
- [Observability](../architecture/observability.md) — Structured Pino logging across all layers (ADR-013).
