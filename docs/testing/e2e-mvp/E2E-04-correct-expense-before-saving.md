# E2E-04: Correct an Expense Before Saving

- [ ] Passed.

## Objective

Prove that a user can correct a reviewed expense in natural language and that only the corrected version is saved.

## Preconditions

- E2E-01 has passed.
- Record the current row count in `Expenses`.

## Steps

1. Send `Pagué 30 EUR por taxi`.
2. When the review summary appears, reply `eran 35 EUR y la categoría es Transporte`.
3. Review the updated summary.
4. Confirm it.
5. Inspect the appended spreadsheet row.

## Expected Results

- The correction returns an updated review summary with amount `35` and category `Transport` or its configured equivalent.
- No row is added after the original summary or after the correction.
- The confirmation saves exactly one row.
- The saved row contains only the corrected amount and category, never the original amount `30`.

## Result

- Date: 2026-09-01
- Tester: Nico
- Environment: development
- Evidence: Conversation transcript supplied by the tester.
- Notes: Failed. After the review for `Pague 30 euros por taxi`, the correction `eran 35 EUR y la categoria es transporte` received only the processing acknowledgement. The bot appears to have enqueued the correction as another expense instead of applying it to the active review. A later `y?` message was also acknowledged without completing the correction; the bot eventually replied `You still have one expense awaiting confirmation and 1 more in the queue. Shall we confirm, correct, or cancel the current one?` This introduced a second defect: the bot switched to English in an otherwise Spanish conversation. No updated summary was returned, so the case could not proceed to confirmation or spreadsheet verification.

## Retest Required

- Status: Pending connected retest after the correction-routing and Spanish queue-copy implementation.
- Verify that the correction returns one updated summary with amount `35 EUR` and the configured transport category.
- Verify that no pending queue entry or spreadsheet row is created by the correction itself.
- Send an unrelated follow-up such as `y?` and verify that the bot responds in Spanish without hanging.
- Confirm the corrected review and verify that exactly one new spreadsheet row contains `35 EUR`, never the original amount `30`.
