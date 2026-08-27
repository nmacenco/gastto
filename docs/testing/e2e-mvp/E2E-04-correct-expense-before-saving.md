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

- Date:
- Tester:
- Environment:
- Evidence:
- Notes:
