# Features

Canonical documentation for product features. **No `docs/features/<feature>.md` = the feature does not exist.**

Use [`TEMPLATE.md`](./TEMPLATE.md) to create new feature documentation.

## Index

- [`account-deletion.md`](./account-deletion.md): Telegram confirmation, durable `/start` replay protection, development deletion worker, durable work counting for Sheets and OAuth, verified queue and Redis cleanup, restore detection and read-only inventory, privacy status, and remaining production gates.

- [`conversational-message-formatting.md`](./conversational-message-formatting.md): Explicit paragraphs, list preservation, and separate cancellation guidance for file/sheet selection and recovery.

- [`telegram-access-approval.md`](./telegram-access-approval.md): First-contact welcome, explicit invalid-email and persistence-failure feedback, Telegram email requests and request-ID lookup, database and Gmail diagnostic logs, manual CLI approval and resend with deletion-fenced notices, guarded cancellation and continuation during OAuth admission, and safe account replacement.

- [`chat-spreadsheet-settings.md`](./chat-spreadsheet-settings.md): Chat settings menu, safe file and sheet changes, category and payment drafts with listed editing examples, and guarded cancellation and expiry.
- [`payment-methods.md`](./payment-methods.md): Configuration-scoped payment catalogs, settings drafts, detection during setup, exact onboarding confirmation, expense review resolution, and legacy compatibility.

- [`semantic-router-evaluation.md`](./semantic-router-evaluation.md): Standalone proposal evaluator plus checksum-pinned, fail-closed release reports, aggregate-safe rollout evidence, guarded enabled dispatch, and migration-free rollback boundaries.

- [`cloud-storage-connection.md`](./cloud-storage-connection.md) — OAuth2 flow, required product-user client configuration, token lifecycle, guarded onboarding cancellation and pending-link renewal, durable deletion-aware callback and refresh fencing, and reminder-based reconnection that reuses a configured sheet and columns.
- [`select-spreadsheet-file.md`](./select-spreadsheet-file.md) — File discovery with persistent empty-result search, deterministic supported-link handling, revision-bound selection, and initial setup cancellation.
- [`select-sheet.md`](./select-sheet.md) — Revision-bound sheet selection, empty-sheet and no-header return paths, IDK guidance, cancellation before destination-change settings, and eager access validation.
- [`validate-spreadsheet-access.md`](./validate-spreadsheet-access.md) — Proactive read/write validation, blank-preview classification, and one OAuth refresh/replay for provider authorization failures.
- [`infer-and-propose-column-mapping.md`](./infer-and-propose-column-mapping.md) — Rule-based + LLM hybrid inference, nonempty no-header recovery with sheet choice or cancellation, proposal identity, untrusted-data boundaries, and optional multilingual subcategory mapping.
- [`confirm-or-correct-column-mapping.md`](./confirm-or-correct-column-mapping.md) — Proposal-bound onboarding confirmation and settings file or sheet candidate mapping, with header checks and isolated corrections.
- [`category-confirmation.md`](./category-confirmation.md) — Reviews category vocabulary before payment methods in onboarding and destination changes, including the exact `confirmar` command, cancellable onboarding, and legacy layout support.
- [`category-vocabulary.md`](./category-vocabulary.md) — Category vocabulary foundation introduced on `main`; the active confirmation flow is documented in `category-confirmation.md`.
- [`subcategory-hierarchy.md`](./subcategory-hierarchy.md) — Detects, drafts, classifies, reviews, saves, retries, and undoes parent-scoped subcategories with stable references, explicit parent commands, and immutable snapshots.
- [`incoming-message-routing.md`](./incoming-message-routing.md) — Strict BullMQ ingestion, durable `/start` replay receipts, access-aware processing acknowledgments and OAuth recovery precedence, deterministic file-link and search routing, bounded lock-contention retries with final best-effort resend guidance, and snapshot-bound expense, option, cancellation, undo, and recovery dispatch.
- [`clarification-request.md`](./clarification-request.md) — Single-question clarification flow with retained-source semantic completion, safe replacement, and queued-batch continuity.
- [`expense-summary-review.md`](./expense-summary-review.md) — Bounded expense extraction, structured summaries with payment resolution, and version-bound confirm, correct, and cancel actions.
- [`expense-cancellation.md`](./expense-cancellation.md) — Exact text/callback and revision-bound natural draft cancellation, plus guarded retry, saving, and undo exits.
- [`expense-correction.md`](./expense-correction.md) — Contextual corrections of amount, category hierarchy, date, and payment method with guarded review revisions.
- [`expense-confirmation.md`](./expense-confirmation.md) — Exact save and retry authorization, mapped-column append, payment-selection checks, account-work fencing, guarded claims, FIFO continuation after successful retry, stale/expired rejection, and administrator guidance for unresolved outcomes.
- [`undo-last-expense.md`](./undo-last-expense.md) — One-record Google Sheets undo using the expense's historical configuration, account-work fencing, exact-target claims, bound delayed confirmation, and safe recovery from pre-deletion failures.
- [`send-responses-to-user.md`](./send-responses-to-user.md) — Channel-agnostic message delivery with retry, chunking, failure classification, and best-effort contention notices.
- [`conversation-state-management.md`](./conversation-state-management.md) — PostgreSQL-backed revisioned FSM with cancellation across active flows, guarded pending OAuth renewal, exact onboarding confirmation, incomplete-destination protection, renewable ownership, retry-to-queue continuation, guarded timeout/queue effects, and financial claims with administrator guidance for unresolved operations.
- [`deployment.md`](./deployment.md) — Merge-protected Fly.io deployment, explicit account-deletion migration and restore gates, Aiven production and development Redis brokers, persistent workers, rollback, graceful shutdown, and Telegram bot isolation.
- [Observability](../architecture/observability.md) — Structured Pino logging across all layers (ADR-013).

- [Security hardening](security-hardening.md): HTTP budgets, secret validation, production/development audit gates, package-manager-free runtime, telemetry, operational runbook and hosted technical validation.

- Payment methods persistence: JSONB snapshot comparison is independent of object key order (see [payment methods](payment-methods.md)).

- Candidate account activation renews expired credentials before cutover (see [Telegram access approval](telegram-access-approval.md)).

## Recovery update (2026-11-15)

Native-file validation and state-aware recovery are documented in [select-spreadsheet-file](./select-spreadsheet-file.md), [select-sheet](./select-sheet.md), [chat-spreadsheet-settings](./chat-spreadsheet-settings.md), [validate-spreadsheet-access](./validate-spreadsheet-access.md), [infer-and-propose-column-mapping](./infer-and-propose-column-mapping.md), [confirm-or-correct-column-mapping](./confirm-or-correct-column-mapping.md), [category-confirmation](./category-confirmation.md), [payment-methods](./payment-methods.md), [cloud-storage-connection](./cloud-storage-connection.md), [telegram-access-approval](./telegram-access-approval.md), [clarification-request](./clarification-request.md), [expense-correction](./expense-correction.md), [expense-summary-review](./expense-summary-review.md), [expense-confirmation](./expense-confirmation.md), [expense-cancellation](./expense-cancellation.md), [incoming-message-routing](./incoming-message-routing.md), [conversation-state-management](./conversation-state-management.md).

## Setup readability update (2026-11-16)

Paragraphs and cancellation guidance now cover [cloud connection](./cloud-storage-connection.md), [access validation](./validate-spreadsheet-access.md), [mapping inference](./infer-and-propose-column-mapping.md), [mapping correction](./confirm-or-correct-column-mapping.md), [categories](./category-confirmation.md), [payments](./payment-methods.md), [settings](./chat-spreadsheet-settings.md), and [access approval](./telegram-access-approval.md). Shared rules and OAuth HTML rendering are documented in [conversational message formatting](./conversational-message-formatting.md).

## Expense readability update (2026-11-16)

Formatting and explicit cancellation ownership now cover [clarification](./clarification-request.md), [correction](./expense-correction.md), [review](./expense-summary-review.md), [confirmation/retry](./expense-confirmation.md), [cancellation](./expense-cancellation.md), [undo](./undo-last-expense.md), [payments](./payment-methods.md), and [worker recovery](./incoming-message-routing.md). See [conversational message formatting](./conversational-message-formatting.md) for the block contract.

## Readability completion (2026-11-16)

The [formatting convention](./conversational-message-formatting.md) now documents the final audit and intentional exceptions. [Delivery](./send-responses-to-user.md) covers newline preservation, bounded Telegram fragments, and the WhatsApp placeholder limitation. Residual guidance is documented in [file selection](./select-spreadsheet-file.md), [sheet selection](./select-sheet.md), [cloud connection](./cloud-storage-connection.md), [settings](./chat-spreadsheet-settings.md), [access approval](./telegram-access-approval.md), [routing](./incoming-message-routing.md), and [expense review](./expense-summary-review.md).
