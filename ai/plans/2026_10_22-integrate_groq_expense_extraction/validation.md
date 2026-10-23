# Groq development validation

## Decision

**Closed for functional expense extraction in `gastto-develop` on 2026-10-23**, based on the operator's Telegram and spreadsheet checks. Groq remains the explicit primary provider with NVIDIA configured as extraction fallback. This decision does not change either automatic provider priority or the production app.

## Evidence

| Check                           | Result                                                                                                              | Source                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Direct Groq access              | Two user-run calls returned HTTP 200; one reported 0.605711 s to first byte and 0.605832 s total                    | Operator report                           |
| Development deployment          | PR #69 merged into `develop`; Fly Machine version 81 started; `/health` returned HTTP 200                           | Deployment and health check on 2026-10-23 |
| Transport                       | Amount `14.8 EUR`, transport category, and explicit date `2026-10-22` appeared in the Telegram review               | Operator report                           |
| Supermarket                     | Amount `8.4 EUR`, configured daily-expense/food hierarchy, and default today appeared in the Telegram review        | Operator report                           |
| Pharmacy                        | Amount `6.5 EUR`, health/pharmacy hierarchy, and default today appeared in the Telegram review                      | Operator report                           |
| Numeric Spanish date regression | The previously failing day-first numeric date reached review as `2026-10-20` after PR #69                           | Operator confirmation                     |
| Explicit save                   | The confirmed expense appeared exactly once in the spreadsheet with the expected date and debit-card payment method | Operator confirmation                     |
| Local quality gates             | 2299 tests passed, 113 skipped; lint, typecheck, build, and formatting passed                                       | Local pre-commit and PR CI                |

The Telegram summary does not display the payment method; the operator checked it in the saved spreadsheet row. Gastto-level HTTP status and latency were not captured for these Telegram cases. No live timeout, HTTP 429, malformed-output, cancellation, or forced fallback test is claimed here; provider-boundary behavior has automated coverage. Those fault scenarios and production promotion require separate evidence if pursued.

No API keys, provider response bodies, bank details, or full expense messages are stored in this record.
