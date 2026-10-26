# Payment methods

## Purpose

Let users configure payment methods for the active spreadsheet destination and review an expense's payment before saving it.

## Implemented behavior

- Payment methods form a flat catalog scoped to one spreadsheet configuration. Settings option `6. Medios de pago` opens a 30-minute draft. `agregar`, `renombrar`, and `quitar` edit only the draft. `confirmar` commits it with the conversation exit in one transaction; `cancelar` and expiry discard it. An empty confirmed catalog is valid. A null confirmation marker retains legacy free-text behavior.
- `detectar` reads distinct values from the mapped `medio_pago` column after the confirmed header, trims and deduplicates them by lowercase name, and adds missing values to the draft. It leaves existing manual entries intact. Provider errors keep the draft available for retry or manual editing. Without a mapped column, local catalog editing remains available and chat explains that payment values will stay local.
- Initial onboarding and destination changes review payment methods after categories. The new destination keeps its own payment catalog and does not copy the former destination's methods. Final confirmation commits the reviewed configuration and catalogs together. In onboarding, category edits and payment proposals remain in the conversation draft until final confirmation.
- Expense extraction receives the active method names as untrusted context. Only exact trimmed, case-insensitive matches become a selected catalog ID. The prompt asks providers to preserve payment text explicitly mentioned by the user, without guessing a card from generic `tarjeta` or inferring payment from category.
- Reviews always show a payment line, including `Sin medio de pago` when absent. An unknown method is shown as unresolved; the save action is hidden and text confirmation is rejected. The user may write `medio de pago: Nombre` to choose an active method, `agregar medio de pago` to add the displayed unknown method, or `sin medio de pago` to clear it. An explicit addition commits the catalog and revised review atomically and remains in the catalog even if the expense is later cancelled.
- Payment corrections can be combined with other corrected fields. A newly unknown payment leaves the updated review unsavable until resolved. Successful resolution and correction advance the review revision and require successful re-presentation before confirmation.
- A successful spreadsheet append writes the canonical selected name only at a mapped payment column. The local expense stores the same immutable text snapshot and nullable stable ID. A destination mismatch or inactive selection is rejected before append. Retry envelopes reuse the reviewed selection without new interpretation; historical expenses and rows are not rewritten.

## Data and compatibility

`user_payment_methods` has a configuration FK, unique normalized name, active flag, and stable UUID. `spreadsheet_configs.payment_methods_confirmed_at` distinguishes legacy and confirmed empty catalogs. `expense_records.payment_method_id` is nullable and uses `ON DELETE SET NULL`; `medio_pago` remains the snapshot. Old review JSONB normalizes to a legacy selection with its existing payment text and no ID.

## Verification

Domain and application tests cover catalog identity, matching, unknown review protection, detection, correction, retry normalization, and worker routing. PostgreSQL integration tests require a container runtime; the local environment used for this change does not provide one.
