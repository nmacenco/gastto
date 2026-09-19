# Features

Canonical documentation for product features. **No `docs/features/<feature>.md` = the feature does not exist.**

Use [`TEMPLATE.md`](./TEMPLATE.md) to create new feature documentation.

## Index

- [`semantic-router-evaluation.md`](./semantic-router-evaluation.md): Standalone offline/live proposal evaluator, versioned control-policy and option-resolution slices, runtime off/shadow observation, enabled expense and guarded file/sheet option dispatch, privacy-safe telemetry, and migration-free rollback boundaries.

- [`cloud-storage-connection.md`](./cloud-storage-connection.md) — OAuth2 flow, encrypted token lifecycle, and transparent Google access-token refresh (MVP), with OneDrive planned for the future.
- [`select-spreadsheet-file.md`](./select-spreadsheet-file.md) — File discovery, deterministic search/direct URL handling, and revision-bound numeric or semantic displayed-file selection.
- [`select-sheet.md`](./select-sheet.md) — Deterministic and revision-bound semantic sheet selection, IDK header guidance, config persistence, and eager access validation within the chosen file.
- [`validate-spreadsheet-access.md`](./validate-spreadsheet-access.md) — Proactive read/write validation before expense recording, with one transparent OAuth refresh/replay for provider authorization failures.
- [`infer-and-propose-column-mapping.md`](./infer-and-propose-column-mapping.md) — Rule-based + LLM hybrid inference with untrusted-data boundaries, optional multilingual subcategory mapping, and category-only compatibility.
- [`confirm-or-correct-column-mapping.md`](./confirm-or-correct-column-mapping.md) — User confirmation and one-field-per-message correction for legacy and optional subcategory mappings, preserving the detected header row for category detection.
- [`category-confirmation.md`](./category-confirmation.md) — Confirms flat or linked category vocabulary only after transactional aggregate persistence, preserving legacy payloads and category-only row layouts.
- [`subcategory-hierarchy.md`](./subcategory-hierarchy.md) — Detects, manages, classifies, reviews, saves, retries, and undoes parent-scoped subcategories with stable references, immutable snapshots, and legacy compatibility.
- [`incoming-message-routing.md`](./incoming-message-routing.md) — Private-chat-only Telegram ingestion with strict BullMQ payload validation, sensitive-command bypasses, and snapshot-bound enabled expense, option, cancellation, and undo-offer dispatch.
- [`clarification-request.md`](./clarification-request.md) — Single-question clarification flow with retained-source semantic completion, safe replacement, and queued-batch continuity.
- [`expense-summary-review.md`](./expense-summary-review.md) — Structured interpreted-expense summary with persisted presentation identity and version-bound confirm / correct / cancel actions.
- [`expense-cancellation.md`](./expense-cancellation.md) — Exact text/callback and revision-bound natural cancellation that cannot cancel a replacement draft.
- [`expense-correction.md`](./expense-correction.md) — Contextual and validated-semantic correction with atomic hierarchy validation and review-revision invalidation of old buttons.
- [`expense-confirmation.md`](./expense-confirmation.md) — Exact whole-message, successfully presented save/retry authorization with guarded persistent claims and stale/expired rejection.
- [`undo-last-expense.md`](./undo-last-expense.md) — One-record Google Sheets undo with exact-target claims, explicit-only immediate eligibility, and bound delayed confirmation for inferred requests.
- [`send-responses-to-user.md`](./send-responses-to-user.md) — Channel-agnostic message delivery with retry, chunking, and failure classification.
- [`conversation-state-management.md`](./conversation-state-management.md) — PostgreSQL-backed revisioned FSM with renewable ownership, review/undo/retry presentation bindings, guarded timeout/queue effects, and financial claims.
- [`deployment.md`](./deployment.md) — Merge-protected multi-environment Fly.io deployment with provider-independent Redis-compatible brokers, persistent BullMQ worker Machines, secure cutover and rollback, graceful shutdown, and Telegram bot isolation.
- [Observability](../architecture/observability.md) — Structured Pino logging across all layers (ADR-013).
