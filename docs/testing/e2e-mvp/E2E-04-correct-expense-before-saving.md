# E2E-04: Correct an Expense Before Saving

- [x] Passed.

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
- Evidence: Conversation transcript and spreadsheet row verified by the tester.
- Notes: Passed on retest. The correction `eran 35 EUR y la categoría es Transporte` returned an updated review summary with amount `35 EUR` and category `transporte`. After confirmation, exactly one corrected expense was verified in the spreadsheet and the original amount `30` was not saved. The concept still contains the original phrase `pague 30 euros por taxi`; normalizing it to a value independent of the amount, such as `Taxi`, is a separate quality improvement and does not block this test.

## Retest

- Status: Passed on 2026-09-01.
- The correction returned one updated summary with amount `35 EUR` and the configured transport category.
- No row was added before confirmation.
- Confirmation saved exactly one corrected row containing `35 EUR`, never the original amount `30`.
