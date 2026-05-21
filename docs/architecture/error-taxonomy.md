# Error Taxonomy — Gastto

> **Why this document exists:** ADR-006 defines three save-error types, but in real code there are more error surfaces: LLM timeout, Redis down, messaging channel down, expired token. An agent that implements error handling without this map will produce inconsistent classifications or invent error strings that do not match `operation_logs`.
> **Related:** [ADR-006 · Confiabilidad del Guardado: Write-with-Confirmation + Retry](../adr/adr.md#adr-006--confiabilidad-del-guardado-write-with-confirmation--retry)

---

## The three `error_type` values in `operation_logs`

Every error persisted to `operation_logs` must use **one of these three exact strings** in the `error_type` column. No other strings are permitted.

| `error_type`      | Causes (concrete)                                                                                                                                         | System action                                                                                                                                                   | User-facing message                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NETWORK_ERROR`   | Timeout contacting Google/Microsoft API; transient HTTP 5xx from spreadsheet provider; DNS failure; TCP reset; Redis unreachable (BullMQ broker)          | Retry automatically with exponential backoff (1s / 2s / 4s). If exhausted, transition to `EXPENSE_SAVING_RETRY` or log to `failed_jobs`.                        | _"Tu planilla no respondió. Vuelvo a intentarlo en unos segundos…"_ (first attempt). If exhausted: _"No pude guardar ahora. Te aviso cuando vuelva a intentarlo."_ |
| `AUTH_ERROR`      | OAuth access token expired; refresh token expired or revoked; HTTP 401/403 from spreadsheet API; user revoked app permissions in Google/Microsoft account | Stop retrying immediately. Notify user with re-authentication link. Set `user.status = 'onboarding'` if the sheet is inaccessible.                              | _"Parece que se perdió el acceso a tu planilla. Toca este enlace para volver a conectarla: [re-auth link]"_                                                        |
| `STRUCTURE_ERROR` | Column or sheet not found (the mapping is stale); row insertion returns invalid range; header row was modified by the user outside Gastto                 | Stop retrying immediately. Notify user with instructions to re-run column mapping (E4-US-05 / E4-US-06). Set `user.status = 'onboarding'` if mapping is broken. | _"Tu planilla cambió y ya no reconozco las columnas. Escribe /mapear para volver a configurarlas."_                                                                |

---

## LLM-specific errors

These errors do **not** map directly to the three `error_type` values above. They are handled inside the NLP engine and surfaced to the worker as controlled failures.

| Error                    | Cause                                                                                              | Handling                                                                                                                                                                       | User-facing message            |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| **LLM timeout**          | The LLM API did not respond within 10 seconds.                                                     | The `LLMPort` adapter throws a controlled error. The worker catches it, logs `error_type: 'NETWORK_ERROR'` (because it is a provider connectivity issue), and retries the job. | Same as `NETWORK_ERROR` above. |
| **Unparseable response** | The LLM returned text that is not valid JSON (e.g., added markdown code fences, extra commentary). | The adapter attempts to strip markdown fences and re-parse. If still unparseable, it logs the raw response and throws. The worker retries.                                     | Same as `NETWORK_ERROR` above. |
| **Invalid JSON schema**  | The LLM returned JSON, but fields are missing, wrong types, or unexpected values.                  | Validated with Zod. If validation fails, the adapter logs the raw response and throws. The worker retries.                                                                     | Same as `NETWORK_ERROR` above. |

> **Important:** LLM errors are **never** classified as `AUTH_ERROR` or `STRUCTURE_ERROR`. They are always provider/network issues or prompt/schema issues, both of which fall under `NETWORK_ERROR` for operational purposes.

---

## Channel errors (Telegram / WhatsApp)

These occur when the system tries to send a message back to the user.

| HTTP status             | Cause                                                                                        | Retry policy                                                                                                                    | System action                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `403 Forbidden`         | The user blocked the bot; the token is invalid; the phone number is not opted in (WhatsApp). | **No retry.** Log to `operation_logs` with `error_type: 'AUTH_ERROR'` and mark the `MessagingIdentity` as `status = 'blocked'`. | Notify user via alternative channel if available; otherwise flag for manual review.                                                                      |
| `5xx Server Error`      | Telegram/WhatsApp API is temporarily down.                                                   | Retry with the same backoff as the main pipeline (1s / 2s / 4s), up to 3 attempts.                                              | If exhausted, log `error_type: 'NETWORK_ERROR'` and proceed with local state update anyway (the user may not receive the message, but the data is safe). |
| `429 Too Many Requests` | Rate limit hit.                                                                              | Read `Retry-After` header if present; otherwise use exponential backoff. Retry up to 3 times.                                   | If exhausted, log `error_type: 'NETWORK_ERROR'`.                                                                                                         |

---

## Rules

### 1. Users never see stack traces or technical messages

Every message shown to a user must be reviewed for tone and clarity. The following are **forbidden** in user-facing output:

- Stack traces
- HTTP status codes (e.g., "Error 500")
- Technical jargon (e.g., "JSON parse error", "Zod validation failed", "BullMQ retry exhausted")
- Internal identifiers (job IDs, user IDs, trace IDs)

If you are logging an error for an engineer, log it to `operation_logs` or `failed_jobs`. If you are telling the user something went wrong, use the exact messages defined in the tables above or have a product person review the copy.

### 2. Silent failures are prohibited

> **No confirmation = no save.**

If the system cannot confirm to the user that a save was successful, the save is **not considered complete**. This means:

- If the spreadsheet write succeeds but the messaging channel is down and the user never receives the confirmation, the operation is logged as `NETWORK_ERROR` and the state remains in `EXPENSE_SAVING_RETRY`.
- If a job exhausts all retries, the user must receive a fallback message telling them the data was not saved and offering a manual copy-paste of the expense.
- There is no code path where a write happens and the user is not notified. If you find yourself writing `await spreadsheet.appendRow(...)` without a subsequent `await messaging.sendMessage(...)`, that is a bug.

---

## Quick reference: error → `error_type` mapping

| Situation                      | `error_type`      | Retry?            |
| ------------------------------ | ----------------- | ----------------- |
| Spreadsheet API timeout        | `NETWORK_ERROR`   | Yes (exponential) |
| Spreadsheet HTTP 5xx           | `NETWORK_ERROR`   | Yes (exponential) |
| Spreadsheet HTTP 401/403       | `AUTH_ERROR`      | No                |
| Column not found after mapping | `STRUCTURE_ERROR` | No                |
| Sheet deleted by user          | `STRUCTURE_ERROR` | No                |
| LLM timeout                    | `NETWORK_ERROR`   | Yes (exponential) |
| LLM invalid JSON               | `NETWORK_ERROR`   | Yes (exponential) |
| Telegram/WhatsApp 403          | `AUTH_ERROR`      | No                |
| Telegram/WhatsApp 5xx          | `NETWORK_ERROR`   | Yes (exponential) |
| Redis down (BullMQ broker)     | `NETWORK_ERROR`   | Yes (exponential) |
| PostgreSQL connection lost     | `NETWORK_ERROR`   | Yes (exponential) |
