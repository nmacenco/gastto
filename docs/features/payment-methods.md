# Payment methods

## Purpose

Let users configure payment methods for the active spreadsheet destination and review an expense's payment before saving it.

## Implemented behavior

- Payment methods form a flat catalog scoped to one spreadsheet configuration. Settings option `6. Medios de pago` opens a 30-minute draft. `agregar`, `renombrar`, and `quitar` edit only the draft. `confirmar` commits it with the conversation exit in one transaction; `cancelar` and expiry discard it. An empty confirmed catalog is valid. A null confirmation marker retains legacy free-text behavior.
- `detectar` reads distinct values from the mapped `medio_pago` column after the confirmed header, trims and deduplicates them by lowercase name, and adds missing values to the draft. It leaves existing manual entries intact. Provider errors keep the draft available for retry or manual editing. Without a mapped column, local catalog editing remains available and chat explains that payment values will stay local.
- Initial onboarding and destination changes review payment methods after categories. The new destination keeps its own payment catalog and does not copy the former destination's methods. Final confirmation commits the reviewed configuration and catalogs together. In onboarding, category edits and payment proposals remain in the conversation draft until final confirmation.
- In initial onboarding, the displayed `confirmar` command advances category review and finalizes payment review. It is recognized as an exact, normalized onboarding command; payment edit commands do not confirm. A successful final commit activates the catalogs and clears the conversation to `IDLE`. A failed or stale commit never sends the completion message.
- Expense extraction receives the active method names as untrusted context. Only exact trimmed, case-insensitive matches become a selected catalog ID. The prompt asks providers to preserve payment text explicitly mentioned by the user, without guessing a card from generic `tarjeta` or inferring payment from category.
- Reviews always show a payment line, including `Sin medio de pago` when absent. An unknown method is shown as unresolved; the save action is hidden and text confirmation is rejected. The user may write `medio de pago: Nombre` to choose an active method, `agregar medio de pago` to add the displayed unknown method, or `sin medio de pago` to clear it. An explicit addition commits the catalog and revised review atomically and remains in the catalog even if the expense is later cancelled.
- Payment corrections can be combined with other corrected fields. A newly unknown payment leaves the updated review unsavable until resolved. Successful resolution and correction advance the review revision and require successful re-presentation before confirmation.
- A successful spreadsheet append writes the canonical selected name only at a mapped payment column. The local expense stores the same immutable text snapshot and nullable stable ID. A destination mismatch or inactive selection is rejected before append. Retry envelopes reuse the reviewed selection without new interpretation; historical expenses and rows are not rewritten.

## Data and compatibility

`user_payment_methods` has a configuration FK, unique normalized name, active flag, and stable UUID. `spreadsheet_configs.payment_methods_confirmed_at` distinguishes legacy and confirmed empty catalogs. `expense_records.payment_method_id` is nullable and uses `ON DELETE SET NULL`; `medio_pago` remains the snapshot. Old review JSONB normalizes to a legacy selection with its existing payment text and no ID.

## Verification

Domain and application tests cover catalog identity, matching, unknown review protection, detection, correction, retry normalization, and worker routing. PostgreSQL integration tests require a container runtime; the local environment used for this change does not provide one.

## Persistence comparison

Payment resolution and final onboarding commits compare persisted JSONB snapshots structurally, preserving array order while ignoring object property order. PostgreSQL may reorder object keys; equivalent snapshots must not be rejected as stale. Revision, expiry, identity and explicit-selection checks remain required. The OWASP remediation validation runs the previously opt-in PostgreSQL suites.

## Recovery guidance (2026-11-15)

Unresolved expense payments advertise the accepted `medio de pago: Nombre`, `agregar medio de pago`, and `sin medio de pago` commands plus cancellation. Settings detection failures retain manual editing and `detectar`, and explicitly offer cancellation. These messages do not authorize saving or add a catalog value implicitly.

## Setup message formatting (2026-11-16)

Setup payment reviews and settings drafts show editing options/examples on individual bullet lines. Unmapped-column warnings, confirmation instructions, draft-discard guidance, and optional cancellation are separate paragraphs. Setup retry failures retain `confirmar`; settings detection failures retain `detectar` and manual editing. Expense messages are outside this formatting migration. See [conversational message formatting](./conversational-message-formatting.md).

## Expense message formatting (2026-11-16)

Expense unresolved-payment guidance presents `medio de pago: Nombre`, `agregar medio de pago`, and `sin medio de pago` on separate bullet lines, followed by the optional cancellation footer. The review remains unsavable until payment resolution; callback button eligibility is unchanged. See [conversational message formatting](./conversational-message-formatting.md).

## Onboarding mapping integrity (2026-11-24)

Category confirmation validates captured destination/header/mapping context before detecting payments and again before final catalog activation. A payment column confirmed at A (index 0) is read from A below the confirmed header. Unexpected loss or replacement of a captured mapping returns to column review and clears the category/payment draft; it must not produce an empty local-only proposal or activation success. Local-only payment editing remains available when the confirmed snapshot deliberately omits `medio_pago`. Payment edits preserve the captured context and validate it before changing the draft. Legacy drafts without a captured mapping snapshot retain compatibility pending the category presentation/recovery phase.
