# Features

Canonical documentation for product features. **No `docs/features/<feature>.md` = the feature does not exist.**

Use [`TEMPLATE.md`](./TEMPLATE.md) to create new feature documentation.

## Index

- [`cloud-storage-connection.md`](./cloud-storage-connection.md) — OAuth2 flow, encrypted token lifecycle, and transparent Google access-token refresh (MVP), with OneDrive planned for the future.
- [`select-spreadsheet-file.md`](./select-spreadsheet-file.md) — File discovery, search, and selection for spreadsheet records.
- [`select-sheet.md`](./select-sheet.md) — Sheet selection within the chosen spreadsheet file.
- [`validate-spreadsheet-access.md`](./validate-spreadsheet-access.md) — Proactive read/write validation before expense recording, with one transparent OAuth refresh/replay for provider authorization failures.
- [`infer-and-propose-column-mapping.md`](./infer-and-propose-column-mapping.md) — Rule-based + LLM hybrid inference engine with untrusted spreadsheet-data boundaries that ranks recognized header rows below titles or summaries and proposes column mappings for Gastto fields.
- [`confirm-or-correct-column-mapping.md`](./confirm-or-correct-column-mapping.md) — User confirmation and one-field-per-message natural-language correction, including preservation of the detected header row for immediate category detection.
- [`category-confirmation.md`](./category-confirmation.md) — Immediately reads the category vocabulary below the detected header, supports persisted add/remove/rename commands, and idempotently finalizes repeated confirmation as an active user in `IDLE`.
- [`incoming-message-routing.md`](./incoming-message-routing.md) — Private-chat-only Telegram ingestion with strict BullMQ payload validation and accent-insensitive, channel-agnostic expense routing.
- [`clarification-request.md`](./clarification-request.md) — Single-question clarification flow for missing or ambiguous expense amount/currency data.
- [`expense-summary-review.md`](./expense-summary-review.md) — Structured interpreted-expense summary with confirm / correct / cancel options before saving.
- [`expense-cancellation.md`](./expense-cancellation.md) — Global safe cancellation of in-progress expense registrations.
- [`expense-correction.md`](./expense-correction.md) — Contextual natural-language correction of amount, currency, category, or date with typed separation from genuine additional expenses.
- [`expense-confirmation.md`](./expense-confirmation.md) — Confirmation with typed correction-versus-queue precedence, Spanish queue feedback, safe single-success Google Sheets writes, transparent OAuth refresh, save-location confirmation, and terminal Google reauthorization recovery.
- [`undo-last-expense.md`](./undo-last-expense.md) — Safe one-record Google Sheets undo with immediate eligibility and delayed explicit confirmation.
- [`send-responses-to-user.md`](./send-responses-to-user.md) — Channel-agnostic message delivery with retry, chunking, and failure classification.
- [`conversation-state-management.md`](./conversation-state-management.md) — PostgreSQL-backed FSM with complete onboarding timeout exits, Spanish queue-aware feedback, and contextual spreadsheet-reconnection transitions.
- [`deployment.md`](./deployment.md) — Merge-protected multi-environment Fly.io deployment with provider-independent Redis-compatible brokers, persistent BullMQ worker Machines, secure cutover and rollback, graceful shutdown, and Telegram bot isolation.
- [Observability](../architecture/observability.md) — Structured Pino logging across all layers (ADR-013).
