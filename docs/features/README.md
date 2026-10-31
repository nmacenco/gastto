# Features

Canonical documentation for product features. **No `docs/features/<feature>.md` = the feature does not exist.**

Use [`TEMPLATE.md`](./TEMPLATE.md) to create new feature documentation.

## Index

- [`chat-spreadsheet-settings.md`](./chat-spreadsheet-settings.md): Chat settings menu, safe file and sheet changes, category and payment drafts with listed editing examples, and guarded cancellation and expiry.
- [`payment-methods.md`](./payment-methods.md): Configuration-scoped payment catalogs, settings drafts, detection during setup, expense review resolution, and legacy compatibility.

- [`semantic-router-evaluation.md`](./semantic-router-evaluation.md): Standalone proposal evaluator plus checksum-pinned, fail-closed release reports, aggregate-safe rollout evidence, guarded enabled dispatch, and migration-free rollback boundaries.

- [`cloud-storage-connection.md`](./cloud-storage-connection.md) — OAuth2 flow, token lifecycle, guarded onboarding cancellation, callback safety, and reconnection that reuses a configured sheet and columns.
- [`select-spreadsheet-file.md`](./select-spreadsheet-file.md) — File discovery, deterministic search/direct URL handling, revision-bound selection, and initial setup cancellation.
- [`select-sheet.md`](./select-sheet.md) — Revision-bound sheet selection, IDK header guidance, initial setup cancellation, and eager access validation.
- [`validate-spreadsheet-access.md`](./validate-spreadsheet-access.md) — Proactive read/write validation before expense recording, with one transparent OAuth refresh/replay for provider authorization failures.
- [`infer-and-propose-column-mapping.md`](./infer-and-propose-column-mapping.md) — Rule-based + LLM hybrid inference, no-header recovery with an explicit cancel escape, proposal identity, untrusted-data boundaries, and optional multilingual subcategory mapping.
- [`confirm-or-correct-column-mapping.md`](./confirm-or-correct-column-mapping.md) — Proposal-bound onboarding confirmation and settings file or sheet candidate mapping, with header checks and isolated corrections.
- [`category-confirmation.md`](./category-confirmation.md) — Reviews category vocabulary before payment methods in onboarding and destination changes, with cancellable onboarding and legacy layout support.
- [`category-vocabulary.md`](./category-vocabulary.md) — Category vocabulary foundation introduced on `main`; the active confirmation flow is documented in `category-confirmation.md`.
- [`subcategory-hierarchy.md`](./subcategory-hierarchy.md) — Detects, drafts, classifies, reviews, saves, retries, and undoes parent-scoped subcategories with stable references, explicit parent commands, and immutable snapshots.
- [`incoming-message-routing.md`](./incoming-message-routing.md) — Strict BullMQ ingestion, sensitive-command and onboarding-restart routing, bounded lock-contention retries, and snapshot-bound expense, option, cancellation, undo, and recovery dispatch.
- [`clarification-request.md`](./clarification-request.md) — Single-question clarification flow with retained-source semantic completion, safe replacement, and queued-batch continuity.
- [`expense-summary-review.md`](./expense-summary-review.md) — Bounded expense extraction, structured summaries with payment resolution, and version-bound confirm, correct, and cancel actions.
- [`expense-cancellation.md`](./expense-cancellation.md) — Exact text/callback and revision-bound natural cancellation that cannot cancel a replacement draft.
- [`expense-correction.md`](./expense-correction.md) — Contextual corrections of amount, category hierarchy, date, and payment method with guarded review revisions.
- [`expense-confirmation.md`](./expense-confirmation.md) — Exact save and retry authorization, mapped-column append, payment-selection checks, guarded claims, and stale/expired rejection.
- [`undo-last-expense.md`](./undo-last-expense.md) — One-record Google Sheets undo using the expense's historical configuration, exact-target claims, and bound delayed confirmation.
- [`send-responses-to-user.md`](./send-responses-to-user.md) — Channel-agnostic message delivery with retry, chunking, and failure classification.
- [`conversation-state-management.md`](./conversation-state-management.md) — PostgreSQL-backed revisioned FSM with onboarding cancellation, incomplete-destination protection, renewable ownership, guarded timeout/queue effects, and financial claims.
- [`deployment.md`](./deployment.md) — Merge-protected multi-environment Fly.io deployment after successful push quality gates, with configurable LLM provider and extraction fallback, provider-independent Redis-compatible brokers, persistent BullMQ worker Machines, secure cutover and rollback, graceful shutdown, and Telegram bot isolation.
- [Observability](../architecture/observability.md) — Structured Pino logging across all layers (ADR-013).
