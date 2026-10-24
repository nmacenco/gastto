# Features

Canonical documentation for product features. **No `docs/features/<feature>.md` = the feature does not exist.**

Use [`TEMPLATE.md`](./TEMPLATE.md) to create new feature documentation.

## Index

- [`chat-spreadsheet-settings.md`](./chat-spreadsheet-settings.md): Chat settings menu, stored connection status, voluntary Google reauthorization, and guarded cancellation and expiry.

- [`semantic-router-evaluation.md`](./semantic-router-evaluation.md): Standalone proposal evaluator plus checksum-pinned, fail-closed release reports, aggregate-safe rollout evidence, guarded enabled dispatch, and migration-free rollback boundaries.

- [`cloud-storage-connection.md`](./cloud-storage-connection.md) — OAuth2 flow, encrypted token lifecycle, transparent Google access-token refresh, and reconnection that reuses a configured sheet and columns (MVP), with OneDrive planned for the future.
- [`select-spreadsheet-file.md`](./select-spreadsheet-file.md) — File discovery, deterministic search/direct URL handling, and revision-bound numeric or semantic displayed-file selection.
- [`select-sheet.md`](./select-sheet.md) — Deterministic and revision-bound semantic sheet selection, IDK header guidance, config persistence, and eager access validation within the chosen file.
- [`validate-spreadsheet-access.md`](./validate-spreadsheet-access.md) — Proactive read/write validation before expense recording, with one transparent OAuth refresh/replay for provider authorization failures.
- [`infer-and-propose-column-mapping.md`](./infer-and-propose-column-mapping.md) — Rule-based + LLM hybrid inference with complete atomic replacement, proposal identity, untrusted-data boundaries, optional multilingual subcategory mapping, and category-only compatibility.
- [`confirm-or-correct-column-mapping.md`](./confirm-or-correct-column-mapping.md) — Proposal-bound confirmation and exclusive one-field-per-message correction, with recoverable displacement, complete atomic persistence, and detected-header preservation.
- [`category-confirmation.md`](./category-confirmation.md) — Confirms flat or linked category vocabulary only after transactional aggregate persistence, preserving legacy payloads and category-only row layouts.
- [`category-vocabulary.md`](./category-vocabulary.md) — Category vocabulary foundation introduced on `main`; the active confirmation flow is documented in `category-confirmation.md`.
- [`subcategory-hierarchy.md`](./subcategory-hierarchy.md) — Detects, manages, classifies, reviews, saves, retries, and undoes parent-scoped subcategories with stable references, immutable snapshots, and legacy compatibility.
- [`incoming-message-routing.md`](./incoming-message-routing.md) — Strict BullMQ ingestion with correlated, recoverable extraction failures and bounded lock-contention retries, accurate failure logs, sensitive-command bypasses and snapshot-bound enabled expense, option, cancellation, undo-offer, request-only retry, and recovery dispatch shared by Telegram and WhatsApp.
- [`clarification-request.md`](./clarification-request.md) — Single-question clarification flow with retained-source semantic completion, safe replacement, and queued-batch continuity.
- [`expense-summary-review.md`](./expense-summary-review.md) — Bounded initial extraction with configurable provider selection, strict Groq GPT-OSS extraction and development validation, one independent fallback, GLM streaming, safe recovery, Spanish numeric-date review, timeout phase diagnostics, and structured interpreted-expense summary with persisted presentation identity and version-bound confirm / correct / cancel actions.
- [`expense-cancellation.md`](./expense-cancellation.md) — Exact text/callback and revision-bound natural cancellation that cannot cancel a replacement draft.
- [`expense-correction.md`](./expense-correction.md) — Contextual and validated-semantic correction with whole-target active-category recovery, rejection of unresolved negations/alternatives, atomic hierarchy validation, and review-revision invalidation of old buttons.
- [`expense-confirmation.md`](./expense-confirmation.md) — Early OAuth check before expense extraction, exact whole-message save/retry authorization, request-only natural retry, bounded reconfiguration, guarded claims, and stale/expired rejection.
- [`undo-last-expense.md`](./undo-last-expense.md) — One-record Google Sheets undo with exact-target claims, explicit-only immediate eligibility, and bound delayed confirmation for inferred requests.
- [`send-responses-to-user.md`](./send-responses-to-user.md) — Channel-agnostic message delivery with retry, chunking, and failure classification.
- [`conversation-state-management.md`](./conversation-state-management.md) — PostgreSQL-backed revisioned FSM with guarded initial-extraction recovery, renewable ownership, review/undo/retry presentation bindings, guarded timeout/queue effects, and financial claims.
- [`deployment.md`](./deployment.md) — Merge-protected multi-environment Fly.io deployment after successful push quality gates, with configurable LLM provider and extraction fallback, provider-independent Redis-compatible brokers, persistent BullMQ worker Machines, secure cutover and rollback, graceful shutdown, and Telegram bot isolation.
- [Observability](../architecture/observability.md) — Structured Pino logging across all layers (ADR-013).
